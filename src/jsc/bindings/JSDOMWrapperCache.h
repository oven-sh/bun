/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2003-2006, 2008-2009, 2013, 2016 Apple Inc. All rights reserved.
 *  Copyright (C) 2007 Samuel Weinig <sam@webkit.org>
 *  Copyright (C) 2009 Google, Inc. All rights reserved.
 *  Copyright (C) 2012 Ericsson AB. All rights reserved.
 *  Copyright (C) 2013 Michael Pruett <michael@68k.org>
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#pragma once

#include "DOMStructureSlot.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapper.h"
#include "ScriptWrappable.h"
#include "ScriptWrappableInlines.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/NeverDestroyed.h>

namespace WebCore {

class ActiveDOMObject;

inline JSDOMGlobalObject* deprecatedGlobalObjectForPrototype(JSC::JSGlobalObject* lexicalGlobalObject)
{
    // FIXME: Callers to this function should be using the global object
    // from which the object is being created, instead of assuming the lexical one.
    // e.g. subframe.document.body should use the subframe's global object, not the lexical one.
    return uncheckedDowncast<JSDOMGlobalObject>(lexicalGlobalObject);
}

template<typename WrapperClass> inline JSC::Structure* getDOMStructure(JSC::VM& vm, JSDOMGlobalObject& globalObject)
{
    constexpr auto slot = DOMStructureSlotOf<WrapperClass>::value;
    if (JSC::Structure* structure = globalObject.domStructure(slot))
        return structure;
    return globalObject.setDOMStructure(slot, WrapperClass::createStructure(vm, &globalObject, WrapperClass::createPrototype(vm, globalObject)));
}

template<typename WrapperClass> inline JSC::JSObject* getDOMPrototype(JSC::VM& vm, JSDOMGlobalObject& globalObject)
{
    return asObject(getDOMStructure<WrapperClass>(vm, globalObject)->storedPrototype());
}

// Decides on the GC's threads whether a cached wrapper outlives the last reference to it.
template<typename WrapperClass> class JSDOMWrapperOwner final : public JSC::WeakHandleOwner {
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, JSC::AbstractSlotVisitor& visitor, ASCIILiteral* reason) final
    {
        auto* wrapper = uncheckedDowncast<WrapperClass>(handle.slot()->asCell());
        if constexpr (std::is_base_of_v<ActiveDOMObject, typename WrapperClass::DOMWrapped>) {
            if (!wrapper->wrapped().isContextStopped() && wrapper->wrapped().hasPendingActivity()) {
                if (reason) [[unlikely]]
                    *reason = "ActiveDOMObject with pending activity"_s;
                return true;
            }
        }
        return wrapper->isReachableFromOpaqueRoots(visitor, reason);
    }

    FinalizeResult finalize(JSC::Handle<JSC::Unknown> handle, void*) final
    {
        auto* wrapper = static_cast<WrapperClass*>(handle.slot()->asCell());
        wrapper->wrapped().clearWrapper(wrapper);
        return FinalizeResult::KeepImpl;
    }
};

template<typename DOMClass> inline JSDOMObject* getCachedWrapper(DOMClass& domObject)
{
    if constexpr (std::is_base_of_v<ScriptWrappable, DOMClass>)
        return domObject.wrapper();
    else
        return nullptr;
}

template<typename DOMClass> inline auto* createWrapper(JSDOMGlobalObject* globalObject, JSC::Structure* structure, Ref<DOMClass>&& domObject)
{
    using WrapperClass = typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass;

    ASSERT(!getCachedWrapper(domObject.get()));
    auto* wrapper = WrapperClass::create(structure, globalObject, WTF::move(domObject));
    if constexpr (std::is_base_of_v<ScriptWrappable, DOMClass>) {
        static NeverDestroyed<JSDOMWrapperOwner<WrapperClass>> owner;
        wrapper->wrapped().setWrapper(wrapper, &owner.get());
    }
    return wrapper;
}

template<typename DOMClass, typename T> inline auto* createWrapper(JSDOMGlobalObject* globalObject, Ref<T>&& domObject)
{
    using WrapperClass = typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass;

    auto* structure = getDOMStructure<WrapperClass>(globalObject->vm(), *globalObject);
    if constexpr (std::is_same_v<DOMClass, T>)
        return createWrapper<DOMClass>(globalObject, structure, WTF::move(domObject));
    else
        return createWrapper<DOMClass>(globalObject, structure, unsafeRefDowncast<DOMClass>(WTF::move(domObject)));
}

// A class with a conversion of its own declares the specialization below its JSDOMWrapperConverterTraits.
template<typename DOMClass, typename = typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass>
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<DOMClass>&& impl)
{
    return createWrapper<DOMClass>(globalObject, WTF::move(impl));
}

template<typename DOMClass> inline JSC::JSValue wrap(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, DOMClass& domObject)
{
    if (auto* wrapper = getCachedWrapper(domObject))
        return wrapper;
    return toJSNewlyCreated(lexicalGlobalObject, globalObject, Ref<DOMClass>(domObject));
}

template<typename DOMClass, typename = typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass>
JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, DOMClass& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

template<typename DOMClass, typename = typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass>
JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, DOMClass* impl)
{
    return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull();
}

// The subclass path (`Reflect.construct` / `class extends`), shared across wrapper classes. nullptr on exception.
JSC::Structure* subclassStructure(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame*, JSC::Structure* (*baseStructure)(JSC::VM&, JSDOMGlobalObject&));

// The Structure a constructor makes its wrapper with. nullptr on exception: the subclass path reads
// `new.target.prototype`, which can run script and throw. So a constructor takes it before X::create()
// does anything the caller cannot take back (a dial, a subscription, a thread).
template<typename DOMClass> inline JSC::Structure* structureForNewTarget(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    using WrapperClass = typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass;

    JSC::JSObject* constructor = callFrame->jsCallee();
    JSC::JSObject* newTarget = callFrame->newTarget().getObject();
    if (newTarget && newTarget != constructor) [[unlikely]]
        return subclassStructure(lexicalGlobalObject, callFrame, getDOMStructure<WrapperClass>);

    // The compiler calls getDOMStructure() out of line. The constructor filled the slot, so read it here.
    auto& globalObject = *uncheckedDowncast<JSDOMGlobalObject>(constructor->globalObject());
    if (JSC::Structure* structure = globalObject.domStructure(DOMStructureSlotOf<WrapperClass>::value)) [[likely]]
        return structure;
    return getDOMStructure<WrapperClass>(JSC::getVM(lexicalGlobalObject), globalObject);
}

// toJSNewlyCreated<IDLInterface<X>>() for a constructor: `structure` comes from structureForNewTarget().
template<typename IDL, typename U> inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, JSC::ThrowScope& throwScope, JSC::Structure* structure, U&& value)
{
    using DOMClass = typename IDL::RawType;

    if constexpr (IsExceptionOr<U>) {
        if (value.hasException()) [[unlikely]] {
            propagateException(lexicalGlobalObject, throwScope, value.releaseException());
            return {};
        }
        return createWrapper<DOMClass>(&globalObject, structure, value.releaseReturnValue());
    } else
        return createWrapper<DOMClass>(&globalObject, structure, std::forward<U>(value));
}

} // namespace WebCore
