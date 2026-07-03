/*
    This file is part of the WebKit open source project.

    This library is free software; you can redistribute it and/or
    modify it under the terms of the GNU Library General Public
    License as published by the Free Software Foundation; either
    version 2 of the License, or (at your option) any later version.

    This library is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
    Library General Public License for more details.

    You should have received a copy of the GNU Library General Public License
    along with this library; see the file COPYING.LIB.  If not, write to
    the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
    Boston, MA 02110-1301, USA.
*/

#pragma once

#include "Clipboard.h"
#include "JSDOMWrapper.h"
#include "JSEventTarget.h"
#include <wtf/NeverDestroyed.h>

namespace WebCore {

class JSClipboard : public JSEventTarget {
public:
    using Base = JSEventTarget;
    using DOMWrapped = Clipboard;
    static JSClipboard* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject, Ref<Clipboard>&& impl)
    {
        JSClipboard* ptr = new (NotNull, JSC::allocateCell<JSClipboard>(globalObject->vm())) JSClipboard(structure, *globalObject, WTF::move(impl));
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray);
    }

    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);
    Clipboard& wrapped() const
    {
        return static_cast<Clipboard&>(Base::wrapped());
    }

protected:
    JSClipboard(JSC::Structure*, JSDOMGlobalObject&, Ref<Clipboard>&&);

    void finishCreation(JSC::VM&);
};

class JSClipboardOwner final : public JSC::WeakHandleOwner {
public:
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, JSC::AbstractSlotVisitor&, ASCIILiteral*) final;
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final;
};

inline JSC::WeakHandleOwner* wrapperOwner(DOMWrapperWorld&, Clipboard*)
{
    static NeverDestroyed<JSClipboardOwner> owner;
    return &owner.get();
}

inline void* wrapperKey(Clipboard* wrappableObject)
{
    return wrappableObject;
}

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, Clipboard&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Clipboard* impl) { return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); }
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<Clipboard>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<Clipboard>&& impl) { return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); }

template<> struct JSDOMWrapperConverterTraits<Clipboard> {
    using WrapperClass = JSClipboard;
    using ToWrappedReturnType = Clipboard*;
};

// The platform backend's truth (via Rust) for which MIME types this build
// can put on / take off the OS clipboard.
bool clipboardSupportsType(const WTF::String&);

} // namespace WebCore
