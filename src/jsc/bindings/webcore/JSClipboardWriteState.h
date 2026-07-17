// JSClipboardWriteState — the context cell of Clipboard.prototype.write's materialization
// loop: the state one write carries across the reactions of the ClipboardItem values that
// settle asynchronously. Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace Bun {
class JSClipboardItem;
}

namespace WebCore {

class JSClipboardWriteState final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSClipboardWriteState* create(JSC::VM&, JSC::Structure*, Bun::JSClipboardItem*, JSC::JSArray* blobs, JSC::JSPromise*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit ALL THREE: an unvisited m_promise is a premature
    // collection of the promise `write()` handed back to JS.
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // the item being written; its types() drive the loop and its values are materialized.
    JSC::WriteBarrier<JSC::JSObject> m_item;
    // the Blob per representation, index-aligned with the item's types(). Filled in order;
    // the platform write reads it once m_index reaches types().size().
    JSC::WriteBarrier<JSC::JSArray> m_blobs;
    // the promise `write()` returned, settled by the platform write or by any failure.
    JSC::WriteBarrier<JSC::JSPromise> m_promise;
    // how many representations are materialized: the index the next reaction stores at.
    unsigned m_index { 0 };

private:
    JSClipboardWriteState(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

// The write loop's two reactions, owned by JSClipboard.cpp. Both take the
// JSClipboardWriteState as their context cell at argument(1).
JSC_DECLARE_HOST_FUNCTION(jsClipboardHandler_onWriteBlobMaterialized);
JSC_DECLARE_HOST_FUNCTION(jsClipboardHandler_onWriteBlobFailed);

} // namespace WebCore
