#include "LintHost.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <algorithm>

namespace Bun {
using namespace JSC;

const ClassInfo LintHost::s_info = { "LintHost"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(LintHost) };

Structure* LintHost::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), info());
}

LintHost* LintHost::create(VM& vm, JSGlobalObject* globalObject)
{
    // Before allocateCell(): nothing may be allocated between that and finishCreation().
    Structure* structure = createStructure(vm, globalObject);
    LintHost* host = new (NotNull, allocateCell<LintHost>(vm)) LintHost(vm, structure);
    host->finishCreation(vm, globalObject);
    return host;
}

void LintHost::destroy(JSCell* cell)
{
    static_cast<LintHost*>(cell)->~LintHost();
}

void LintHost::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    JSObject* objectPrototype = globalObject->objectPrototype();
    m_positionStructure.set(vm, this, createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "line"_s, "column"_s })));
    m_locStructure.set(vm, this, createShape(vm, globalObject, objectPrototype, std::to_array<ASCIILiteral>({ "start"_s, "end"_s })));
    report.finishCreation(vm, globalObject, this);
    sourceCode.finishCreation(vm, globalObject, this);
    tokens.finishCreation(vm, globalObject, this);
    endFile(vm);
}

// There is one LintHost in a VM. Marking it doesn't need SlotVisitor::append inlined at every field.
template<typename Visitor>
struct OutOfLineVisitor {
    Visitor& visitor;
    template<typename Barrier>
    NEVER_INLINE void append(const Barrier& barrier) { visitor.append(barrier); }
};

template<typename Visitor>
void LintHost::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<LintHost>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    OutOfLineVisitor<Visitor> fields { visitor };
    fields.append(thisObject->m_positionStructure);
    fields.append(thisObject->m_locStructure);
    fields.append(thisObject->m_text);
    thisObject->report.visit(fields);
    thisObject->sourceCode.visit(fields);
    Locker locker { thisObject->cellLock() };
    thisObject->scopes.visit(fields);
    thisObject->nodes.visit(fields);
    thisObject->tokens.visit(fields);
}

DEFINE_VISIT_CHILDREN(LintHost);

Structure* LintHost::createShape(VM& vm, JSGlobalObject* globalObject, JSObject* prototype, std::span<const ASCIILiteral> keys)
{
    RELEASE_ASSERT(keys.size() <= JSFinalObject::maxInlineCapacity);
    Structure* structure = JSFinalObject::createStructure(vm, globalObject, prototype, keys.size());
    for (size_t i = 0; i < keys.size(); ++i) {
        PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, keys[i]), 0, offset);
        RELEASE_ASSERT(offset == static_cast<PropertyOffset>(i));
    }
    return structure;
}

void LintHost::beginFile(VM& vm, JSString* text, uint32_t flags)
{
    m_text.set(vm, this, text);
    m_textString = text->tryGetValue();
    m_flags = flags;
    m_isLinting = true;
    m_lineStarts.clear();
    // Also what a plugin has asked for or reported between two files, from a promise or a timer.
    report.endFile();
    scopes.endFile();
    sourceCode.endFile();
    Locker locker { cellLock() };
    tokens.reset();
    tokens.searchesEverywhere = isOxlint();
}

void LintHost::endFile(VM& vm)
{
    beginFile(vm, jsEmptyString(vm), 0);
    m_isLinting = false;
}

void LintHost::findLineStarts()
{
    m_lastLine = 1;
    m_lineStarts.append(0);
    // `\r\n`, `\r`, `\n`, U+2028 and U+2029 end a line.
    auto scan = [&](auto characters) {
        for (size_t i = 0; i < characters.size(); ++i) {
            auto character = characters[i];
            if (character == '\r') {
                if (i + 1 < characters.size() && characters[i + 1] == '\n')
                    ++i;
            } else if (character != '\n' && (character | 1) != 0x2029)
                continue;
            m_lineStarts.append(static_cast<uint32_t>(i + 1));
        }
    };
    if (m_textString.is8Bit())
        scan(m_textString.span8());
    else
        scan(m_textString.span16());
}

LintHost::Position LintHost::positionOf(double index)
{
    auto& starts = lineStarts();
    size_t line = m_lastLine;
    if (!(starts[line - 1] <= index && (line == starts.size() || index < starts[line]))) {
        line = std::upper_bound(starts.begin(), starts.end(), index, [](double index, uint32_t start) { return index < start; }) - starts.begin();
        if (!line)
            return { 0, PNaN };
        m_lastLine = static_cast<uint32_t>(line);
    }
    return { static_cast<uint32_t>(line), index - starts[line - 1] };
}

JSObject* LintHost::createPosition(VM& vm, double index)
{
    auto [line, column] = positionOf(index);
    JSFinalObject* position = JSFinalObject::create(vm, m_positionStructure.get());
    position->putDirectOffset(vm, 0, jsNumber(line));
    position->putDirectOffset(vm, 1, jsNumber(column));
    return position;
}

// `beginFile(text, flags)`
JSC_DEFINE_HOST_FUNCTION(jsLintBeginFile, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue text = callFrame->argument(0);
    JSValue flags = callFrame->argument(1);
    // Not isUInt32(): once the caller is JIT-compiled, a value read from a Uint32Array can arrive boxed as a double.
    if (!text.isString() || !flags.isNumber())
        return throwVMTypeError(globalObject, scope, "Expected a text and flags"_s);
    asString(text)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    LintHost::from(globalObject)->beginFile(vm, asString(text), JSC::toUInt32(flags.asNumber()));
    return JSValue::encode(jsUndefined());
}

// `endFile()`
JSC_DEFINE_HOST_FUNCTION(jsLintEndFile, (JSGlobalObject * globalObject, CallFrame*))
{
    LintHost::from(globalObject)->endFile(globalObject->vm());
    return JSValue::encode(jsUndefined());
}

// For src/runtime/cli/lint_js.rs, which frees what the spans point to right after this.
extern "C" void Bun__Lint__endFile(JSGlobalObject* globalObject)
{
    LintHost::from(globalObject)->endFile(globalObject->vm());
}

NEVER_INLINE void addLintFunction(JSGlobalObject* globalObject, JSObject* object, ASCIILiteral name, unsigned length, NativeFunction function)
{
    VM& vm = globalObject->vm();
    object->putDirect(vm, Identifier::fromString(vm, name), JSFunction::create(vm, globalObject, length, name, function, ImplementationVisibility::Public));
}

void addLintHostFunctions(JSGlobalObject* globalObject, JSObject* native)
{
    addLintFunction(globalObject, native, "beginFile"_s, 2, jsLintBeginFile);
    addLintFunction(globalObject, native, "endFile"_s, 0, jsLintEndFile);
    addLintReportFunctions(globalObject, native);
    addLintSourceCodeFunctions(globalObject, native);
    addLintTokenFunctions(globalObject, native);
}

JSObject* createLintHost(VM& vm, JSGlobalObject* globalObject)
{
    return LintHost::create(vm, globalObject);
}

} // namespace Bun
