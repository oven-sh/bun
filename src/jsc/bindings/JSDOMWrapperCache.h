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
#include "DOMWrapperWorld.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapper.h"
#include "ScriptWrappable.h"
#include "ScriptWrappableInlines.h"
#include "WebCoreTypedArrayController.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>

namespace WebCore {

template<typename WrapperClass> JSC::Structure* getDOMStructure(JSC::VM&, JSDOMGlobalObject&);
template<typename WrapperClass> JSC::JSObject* getDOMPrototype(JSC::VM&, JSDOMGlobalObject&);

JSC::WeakHandleOwner* wrapperOwner(DOMWrapperWorld&, JSC::ArrayBuffer*);

template<typename DOMClass> inline constexpr bool hasInlineWrapperCache = std::is_base_of_v<ScriptWrappable, DOMClass> || std::is_same_v<DOMClass, JSC::ArrayBuffer>;

JSDOMObject* getInlineCachedWrapper(DOMWrapperWorld&, ScriptWrappable*);
JSC::JSArrayBuffer* getInlineCachedWrapper(DOMWrapperWorld&, JSC::ArrayBuffer*);

void setInlineCachedWrapper(DOMWrapperWorld&, ScriptWrappable*, JSDOMObject* wrapper, JSC::WeakHandleOwner* wrapperOwner);
void setInlineCachedWrapper(DOMWrapperWorld&, JSC::ArrayBuffer*, JSC::JSArrayBuffer* wrapper, JSC::WeakHandleOwner* wrapperOwner);

void clearInlineCachedWrapper(DOMWrapperWorld&, ScriptWrappable*, JSDOMObject* wrapper);
void clearInlineCachedWrapper(DOMWrapperWorld&, JSC::ArrayBuffer*, JSC::JSArrayBuffer* wrapper);

template<typename DOMClass> JSC::JSObject* getCachedWrapper(DOMWrapperWorld&, DOMClass&);
template<typename DOMClass> inline JSC::JSObject* getCachedWrapper(DOMWrapperWorld& world, Ref<DOMClass>& object) { return getCachedWrapper(world, object.get()); }
template<typename DOMClass, typename WrapperClass> void cacheWrapper(DOMWrapperWorld&, DOMClass*, WrapperClass*);
template<typename DOMClass, typename WrapperClass> void uncacheWrapper(DOMWrapperWorld&, DOMClass*, WrapperClass*);
template<typename DOMClass, typename T> auto createWrapper(JSDOMGlobalObject*, Ref<T>&&) -> typename std::enable_if<std::is_same<DOMClass, T>::value, typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass*>::type;
template<typename DOMClass, typename T> auto createWrapper(JSDOMGlobalObject*, Ref<T>&&) -> typename std::enable_if<!std::is_same<DOMClass, T>::value, typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass*>::type;

template<typename DOMClass> JSC::JSValue wrap(JSC::JSGlobalObject*, JSDOMGlobalObject*, DOMClass&);

// Inline functions and template definitions.

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

inline JSC::WeakHandleOwner* wrapperOwner(DOMWrapperWorld& world, JSC::ArrayBuffer*)
{
    return static_cast<WebCoreTypedArrayController*>(world.vm().m_typedArrayController.get())->wrapperOwner();
}

inline JSDOMObject* getInlineCachedWrapper(DOMWrapperWorld& world, ScriptWrappable* domObject)
{
    if (!world.isNormal())
        return nullptr;
    return domObject->wrapper();
}

inline JSC::JSArrayBuffer* getInlineCachedWrapper(DOMWrapperWorld& world, JSC::ArrayBuffer* buffer)
{
    if (!world.isNormal())
        return nullptr;
    return buffer->m_wrapper.get();
}

inline void setInlineCachedWrapper(DOMWrapperWorld& world, ScriptWrappable* domObject, JSDOMObject* wrapper, JSC::WeakHandleOwner* wrapperOwner)
{
    if (!world.isNormal())
        return;
    domObject->setWrapper(wrapper, wrapperOwner, &world);
}

inline void setInlineCachedWrapper(DOMWrapperWorld& world, JSC::ArrayBuffer* domObject, JSC::JSArrayBuffer* wrapper, JSC::WeakHandleOwner* wrapperOwner)
{
    if (!world.isNormal())
        return;
    domObject->m_wrapper = JSC::Weak<JSC::JSArrayBuffer>(wrapper, wrapperOwner, &world);
}

inline void clearInlineCachedWrapper(DOMWrapperWorld& world, ScriptWrappable* domObject, JSDOMObject* wrapper)
{
    if (!world.isNormal())
        return;
    domObject->clearWrapper(wrapper);
}

inline void clearInlineCachedWrapper(DOMWrapperWorld& world, JSC::ArrayBuffer* domObject, JSC::JSArrayBuffer* wrapper)
{
    if (!world.isNormal())
        return;
    weakClear(domObject->m_wrapper, wrapper);
}

template<typename DOMClass> inline JSC::JSObject* getCachedWrapper(DOMWrapperWorld& world, DOMClass& domObject)
{
    if constexpr (hasInlineWrapperCache<DOMClass>)
        return getInlineCachedWrapper(world, &domObject);
    else
        return nullptr;
}

template<typename DOMClass, typename WrapperClass> inline void cacheWrapper(DOMWrapperWorld& world, DOMClass* domObject, WrapperClass* wrapper)
{
    if constexpr (hasInlineWrapperCache<DOMClass>)
        setInlineCachedWrapper(world, domObject, wrapper, wrapperOwner(world, domObject));
}

template<typename DOMClass, typename WrapperClass> inline void uncacheWrapper(DOMWrapperWorld& world, DOMClass* domObject, WrapperClass* wrapper)
{
    if constexpr (hasInlineWrapperCache<DOMClass>)
        clearInlineCachedWrapper(world, domObject, wrapper);
}

template<typename DOMClass, typename T> inline auto createWrapper(JSDOMGlobalObject* globalObject, Ref<T>&& domObject) -> typename std::enable_if<std::is_same<DOMClass, T>::value, typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass*>::type
{
    using WrapperClass = typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass;

    ASSERT(!getCachedWrapper(globalObject->world(), domObject));
    auto* domObjectPtr = domObject.ptr();
    auto* wrapper = WrapperClass::create(getDOMStructure<WrapperClass>(globalObject->vm(), *globalObject), globalObject, WTF::move(domObject));
    cacheWrapper(globalObject->world(), domObjectPtr, wrapper);
    return wrapper;
}

template<typename DOMClass, typename T> inline auto createWrapper(JSDOMGlobalObject* globalObject, Ref<T>&& domObject) -> typename std::enable_if<!std::is_same<DOMClass, T>::value, typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass*>::type
{
    return createWrapper<DOMClass>(globalObject, unsafeRefDowncast<DOMClass>(WTF::move(domObject)));
}

template<typename DOMClass> inline JSC::JSValue wrap(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, DOMClass& domObject)
{
    if (auto* wrapper = getCachedWrapper(globalObject->world(), domObject))
        return wrapper;
    return toJSNewlyCreated(lexicalGlobalObject, globalObject, Ref<DOMClass>(domObject));
}

// The subclass path (`Reflect.construct` / `class extends`), shared across wrapper classes.
void setSubclassStructure(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame*, JSC::JSObject*, JSC::Structure* (*baseStructure)(JSC::VM&, JSDOMGlobalObject&));

template<typename DOMClass> inline void setSubclassStructureIfNeeded(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, JSC::JSObject* jsObject)
{
    JSC::JSObject* newTarget = callFrame->newTarget().getObject();
    if (!newTarget || newTarget == callFrame->jsCallee())
        return;

    using WrapperClass = typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass;
    setSubclassStructure(lexicalGlobalObject, callFrame, jsObject, getDOMStructure<WrapperClass>);
}

} // namespace WebCore
