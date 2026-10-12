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
    LintHost* host = new (NotNull, allocateCell<LintHost>(vm)) LintHost(vm, createStructure(vm, globalObject));
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

template<typename Visitor>
void LintHost::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<LintHost>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_positionStructure);
    visitor.append(thisObject->m_locStructure);
    visitor.append(thisObject->m_text);
    thisObject->report.visit(visitor);
    thisObject->sourceCode.visit(visitor);
    Locker locker { thisObject->cellLock() };
    thisObject->tokens.visit(visitor);
}

DEFINE_VISIT_CHILDREN(LintHost);

LintHost* LintHost::from(JSGlobalObject* globalObject)
{
    return uncheckedDowncast<LintHost>(defaultGlobalObject(globalObject)->m_lintHost.getInitializedOnMainThread(globalObject));
}

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
    Locker locker { cellLock() };
    tokens.reset();
}

void LintHost::endFile(VM& vm)
{
    beginFile(vm, jsEmptyString(vm), 0);
    m_isLinting = false;
    report.endFile();
    sourceCode.endFile();
}

const Vector<uint32_t>& LintHost::lineStarts()
{
    if (!m_lineStarts.isEmpty())
        return m_lineStarts;
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
    return m_lineStarts;
}

LintHost::Position LintHost::positionOf(double index)
{
    auto& starts = lineStarts();
    size_t line = std::upper_bound(starts.begin(), starts.end(), index, [](double index, uint32_t start) { return index < start; }) - starts.begin();
    return { static_cast<uint32_t>(line), line ? index - starts[line - 1] : PNaN };
}

JSObject* LintHost::createPosition(VM& vm, double index)
{
    auto [line, column] = positionOf(index);
    JSFinalObject* position = JSFinalObject::create(vm, m_positionStructure.get());
    position->putDirectOffset(vm, 0, jsNumber(line));
    position->putDirectOffset(vm, 1, jsNumber(column));
    return position;
}

JSObject* LintHost::createLoc(VM& vm, double start, double end)
{
    JSFinalObject* loc = JSFinalObject::create(vm, m_locStructure.get());
    loc->putDirectOffset(vm, 0, createPosition(vm, start));
    loc->putDirectOffset(vm, 1, createPosition(vm, end));
    return loc;
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

void addLintHostFunctions(JSGlobalObject* globalObject, JSObject* native)
{
    VM& vm = globalObject->vm();
    native->putDirect(vm, Identifier::fromString(vm, "beginFile"_s), JSFunction::create(vm, globalObject, 2, "beginFile"_s, jsLintBeginFile, ImplementationVisibility::Public));
    native->putDirect(vm, Identifier::fromString(vm, "endFile"_s), JSFunction::create(vm, globalObject, 0, "endFile"_s, jsLintEndFile, ImplementationVisibility::Public));
    addLintReportFunctions(globalObject, native);
    addLintSourceCodeFunctions(globalObject, native);
    addLintTokenFunctions(globalObject, native);
}

JSObject* createLintHost(VM& vm, JSGlobalObject* globalObject)
{
    return LintHost::create(vm, globalObject);
}

} // namespace Bun
