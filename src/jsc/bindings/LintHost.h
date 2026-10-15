#pragma once

#include "root.h"

#include "LintNodes.h"
#include "LintReport.h"
#include "LintScopes.h"
#include "LintSourceCode.h"
#include "LintTokens.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSString.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// Everything `bun lint` keeps in native code for JavaScript plugins. There's one per global object, and plugins can't reach it.
// It holds Structures that are built once, and the state of the file that's being linted.
//
// The methods plugins call never look at `this`. They work detached, through `Object.create(sourceCode)` and through a Proxy, and
// a `sourceCode` kept from an earlier file answers about the current file. So no object a plugin holds points at per-file data.
class LintHost final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::CompleteSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.destructibleObjectSpace();
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static LintHost* create(JSC::VM&, JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*);
    static void destroy(JSC::JSCell*);

    // For a host function, which gets the global object it was made in, whoever calls it. A custom getter starts with `realmOfHolder`.
    static LintHost* from(JSC::JSGlobalObject* globalObject)
    {
        return uncheckedDowncast<LintHost>(uncheckedDowncast<Zig::GlobalObject>(globalObject)->m_lintHost.getInitializedOnMainThread(globalObject));
    }

    // The global object for a custom getter to use, in place of the one it's passed: a plugin can read a node in a `node:vm` context, whose global
    // object is of another class. `holder`: its `thisValue`. For a `CustomValue`, which all here are, that's the object with the property, not the
    // receiver. Null if that isn't an object made here.
    static Zig::GlobalObject* realmOfHolder(JSC::EncodedJSValue holder)
    {
        JSC::JSObject* object = JSC::JSValue::decode(holder).getObject();
        JSC::JSGlobalObject* realm = object ? object->structure()->realm() : nullptr;
        return realm ? dynamicDowncast<Zig::GlobalObject>(realm) : nullptr;
    }

    // A Structure for plain objects with `keys` as inline data properties, at the offsets 0, 1, 2 and so on.
    static JSC::Structure* createShape(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype, std::span<const ASCIILiteral> keys);

    // `text` has no byte order mark and isn't a rope. `flags` is the first word of the LINT message.
    void beginFile(JSC::VM&, JSC::JSString* text, uint32_t flags);
    // Between files the text is empty.
    void endFile(JSC::VM&);
    bool isLinting() const { return m_isLinting; }

    JSC::JSString* text() const { return m_text.get(); }
    const WTF::String& textString() const { return m_textString; }
    bool wantsFixes() const { return m_flags & 1; }
    bool hasBOM() const { return m_flags & 2; }
    // typescript-estree's tree and tokens if not.
    bool isEspree() const { return m_flags & 4; }
    // The configuration is oxlint's, so plugins get what oxlint would give them.
    bool isOxlint() const { return m_flags & 16; }
    // See `shortens_nodes` in src/lint/js_plugin/ast.rs.
    bool shortensNodes() const { return m_flags & 256; }

    // The index where each line starts. The first is 0.
    const WTF::Vector<uint32_t>& lineStarts()
    {
        if (m_lineStarts.isEmpty()) [[unlikely]]
            findLineStarts();
        return m_lineStarts;
    }
    // Where `index` is. Nobody has to check it first. One past the end of the text counts as part of the last line, NaN too, and
    // a negative one is in line 0.
    struct Position {
        uint32_t line;
        double column;
    };
    Position positionOf(double index);
    // `{ line, column }`
    JSC::JSObject* createPosition(JSC::VM&, double index);
    JSC::Structure* positionStructure() const { return m_positionStructure.get(); }
    JSC::Structure* locStructure() const { return m_locStructure.get(); }
    // `loc.start` and `loc.end`, if `loc` is as `lintCreateLoc` has made it. If not it has to be asked.
    bool readLoc(JSC::JSValue loc, JSC::JSValue& start, JSC::JSValue& end) const
    {
        if (!loc.isCell())
            return false;
        JSC::Structure* structure = loc.asCell()->structure();
        for (auto& shape : tokens.locShapes) {
            if (shape.structure.get() != structure)
                continue;
            start = asObject(loc)->getDirect(shape.isReversed ? 1 : 0);
            end = asObject(loc)->getDirect(shape.isReversed ? 0 : 1);
            return true;
        }
        return false;
    }
    // The same for `position.line` and `position.column`, also of what `createPosition` has made.
    bool readPosition(JSC::JSValue position, JSC::JSValue& line, JSC::JSValue& column) const
    {
        if (!position.isCell())
            return false;
        JSC::Structure* structure = position.asCell()->structure();
        for (auto& shape : tokens.locShapes) {
            if (shape.positionStructure.get() != structure)
                continue;
            line = asObject(position)->getDirect(shape.isReversed ? 1 : 0);
            column = asObject(position)->getDirect(shape.isReversed ? 0 : 1);
            return true;
        }
        return false;
    }

    LintNodeState nodes;
    LintReportState report;
    LintScopeState scopes;
    LintSourceCodeState sourceCode;
    LintTokenState tokens;

private:
    LintHost(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
    void findLineStarts();

    JSC::WriteBarrier<JSC::Structure> m_positionStructure;
    JSC::WriteBarrier<JSC::Structure> m_locStructure;

    JSC::WriteBarrier<JSC::JSString> m_text;
    WTF::String m_textString;
    uint32_t m_flags { 0 };
    bool m_isLinting { false };
    // Empty until it's asked for.
    WTF::Vector<uint32_t> m_lineStarts;
    // The line that was found last. The next position that's asked for is mostly in it.
    uint32_t m_lastLine { 1 };
};

// `target[name]`. An own data property of an ordinary object is found without a walk through the prototype chain.
inline JSC::JSValue lintGet(JSC::JSGlobalObject* globalObject, JSC::JSValue target, const JSC::Identifier& name)
{
    if (target.isObject()) [[likely]] {
        JSC::JSObject* object = asObject(target);
        JSC::Structure* structure = object->structure();
        if (!structure->typeInfo().overridesGetOwnPropertySlot()) [[likely]] {
            unsigned attributes;
            JSC::PropertyOffset offset = structure->get(globalObject->vm(), name, attributes);
            if (offset != JSC::invalidOffset && !(attributes & (JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::CustomAccessorOrValue))) [[likely]]
                return object->getDirect(offset);
        }
    }
    return target.get(globalObject, name);
}

// `target[index]`
inline JSC::JSValue lintGetIndex(JSC::JSGlobalObject* globalObject, JSC::JSValue target, unsigned index)
{
    if (target.isCell() && isJSArray(target.asCell())) [[likely]] {
        JSC::JSArray* array = asArray(target);
        if (array->canGetIndexQuickly(index)) [[likely]]
            return array->getIndexQuickly(index);
    }
    return target.get(globalObject, index);
}

struct LintSpan {
    const uint8_t* ptr;
    size_t len;
};

// src/runtime/cli/lint_js.rs. Asks Rust about the file that's being linted. `kind` is one of `ask` in src/lint/js_plugin/wire.rs.
// The answer is Rust's memory, aligned to 8 bytes. It stays as it is and where it is until Rust calls `Bun__Lint__endFile`, so keep the span, not a copy,
// and drop it in `endFile`. Asking again without details gives the same span. It's `{ nullptr, 0 }` if no file is being linted.
extern "C" LintSpan Bun__Lint__ask(JSC::JSGlobalObject*, uint32_t kind, const uint8_t* details, size_t detailsLength);

// For the lazy `m_lintHost` of ZigGlobalObject.
JSC::JSObject* createLintHost(JSC::VM&, JSC::JSGlobalObject*);

// Adds what the program in src/lint/js_plugin/worker calls to its `native` object.
void addLintHostFunctions(JSC::JSGlobalObject*, JSC::JSObject* native);
// `object[name] = function`
void addLintFunction(JSC::JSGlobalObject*, JSC::JSObject*, ASCIILiteral name, unsigned length, JSC::NativeFunction);

} // namespace Bun
