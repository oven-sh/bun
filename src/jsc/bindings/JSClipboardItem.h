#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// https://w3c.github.io/clipboard-apis/#clipboarditem
// A constructible, immutable record of MIME type → ClipboardItemData (a
// string, a Blob, or a promise of either). The user-provided values are held
// in WriteBarriers and visited, so promises settle and Blobs stay alive.
class JSClipboardItem final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSClipboardItem* create(JSC::VM&, JSC::Structure*, WTF::Vector<WTF::String>&& types, const JSC::MarkedArgumentBuffer& values, WTF::String&& presentationStyle);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray);
    }

    static void destroy(JSC::JSCell*);
    ~JSClipboardItem();

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static size_t estimatedSize(JSC::JSCell*, JSC::VM&);

    const WTF::Vector<WTF::String>& types() const { return m_types; }
    const WTF::String& presentationStyle() const { return m_presentationStyle; }
    // The ClipboardItemData the constructor stored for `types()[index]`: a string, a Blob,
    // or a promise of either. `Clipboard.prototype.write` materializes these itself.
    JSC::JSValue valueAt(unsigned index) const { return m_values[index].get(); }

    // The `types` FrozenArray (the same JSArray on every get, per WebIDL).
    JSC::JSObject* frozenTypes(JSC::JSGlobalObject*);
    // The promise `getType()` returns: the stored value, awaited and
    // normalized to a Blob of the requested type.
    JSC::JSValue getTypePromise(JSC::JSGlobalObject*, const WTF::String& type);

private:
    JSC::JSValue getTypePromiseAtIndex(JSC::JSGlobalObject*, unsigned index);
    JSClipboardItem(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, WTF::Vector<WTF::String>&& types, const JSC::MarkedArgumentBuffer& values, WTF::String&& presentationStyle);

    WTF::Vector<WTF::String> m_types;
    WTF::String m_presentationStyle;
    WTF::Vector<JSC::WriteBarrier<JSC::Unknown>> m_values;
    JSC::LazyProperty<JSClipboardItem, JSC::JSObject> m_frozenTypes;
};

// Normalizes one settled ClipboardItemData to a Blob carrying `type`: a Blob already
// declaring that type passes through; any other value is ToString-coerced (WebIDL
// `(DOMString or Blob)`) into `new Blob([value], { type })`. Synchronous — the caller has
// already awaited what needed awaiting.
JSC::JSValue clipboardDataToBlob(JSC::JSGlobalObject*, JSC::JSValue data, const WTF::String& type);

// `getType()`'s reaction: normalizes the settled value. Its context cell at argument(1) is
// an InternalFieldTuple{JSClipboardItem, index}, and its return value settles the promise
// `getType()` handed back.
JSC_DECLARE_HOST_FUNCTION(jsClipboardHandler_onGetTypeSettled);

void setupClipboardItemClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
