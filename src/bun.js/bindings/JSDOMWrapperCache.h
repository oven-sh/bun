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

WEBCORE_EXPORT JSC::Structure* getCachedDOMStructure(const JSDOMGlobalObject&, const JSC::ClassInfo*);
WEBCORE_EXPORT JSC::Structure* cacheDOMStructure(JSDOMGlobalObject&, JSC::Structure*, const JSC::ClassInfo*);

template<typename WrapperClass> JSC::Structure* getDOMStructure(JSC::VM&, JSDOMGlobalObject&);
template<typename WrapperClass> JSC::Structure* deprecatedGetDOMStructure(JSC::JSGlobalObject*);
template<typename WrapperClass> JSC::JSObject* getDOMPrototype(JSC::VM&, JSC::JSGlobalObject*);

JSC::WeakHandleOwner* wrapperOwner(DOMWrapperWorld&, JSC::ArrayBuffer*);
void* wrapperKey(JSC::ArrayBuffer*);

JSDOMObject* getInlineCachedWrapper(DOMWrapperWorld&, void*);
JSDOMObject* getInlineCachedWrapper(DOMWrapperWorld&, ScriptWrappable*);
JSC::JSArrayBuffer* getInlineCachedWrapper(DOMWrapperWorld&, JSC::ArrayBuffer*);

bool setInlineCachedWrapper(DOMWrapperWorld&, void*, JSDOMObject*, JSC::WeakHandleOwner*);
bool setInlineCachedWrapper(DOMWrapperWorld&, ScriptWrappable*, JSDOMObject* wrapper, JSC::WeakHandleOwner* wrapperOwner);
bool setInlineCachedWrapper(DOMWrapperWorld&, JSC::ArrayBuffer*, JSC::JSArrayBuffer* wrapper, JSC::WeakHandleOwner* wrapperOwner);

bool clearInlineCachedWrapper(DOMWrapperWorld&, void*, JSDOMObject*);
bool clearInlineCachedWrapper(DOMWrapperWorld&, ScriptWrappable*, JSDOMObject* wrapper);
bool clearInlineCachedWrapper(DOMWrapperWorld&, JSC::ArrayBuffer*, JSC::JSArrayBuffer* wrapper);

template<typename DOMClass> JSC::JSObject* getOrCreateWrapper(DOMWrapperWorld&, DOMClass&);

template<typename DOMClass> JSC::JSObject* getCachedWrapper(DOMWrapperWorld&, DOMClass&);
template<typename DOMClass> inline JSC::JSObject* getCachedWrapper(DOMWrapperWorld& world, Ref<DOMClass>& object) { return getCachedWrapper(world, object.get()); }
template<typename DOMClass, typename WrapperClass> void cacheWrapper(DOMWrapperWorld&, DOMClass*, WrapperClass*);
template<typename DOMClass, typename WrapperClass> void uncacheWrapper(DOMWrapperWorld&, DOMClass*, WrapperClass*);
template<typename DOMClass, typename T> auto createWrapper(JSDOMGlobalObject*, Ref<T>&&) -> typename std::enable_if<std::is_same<DOMClass, T>::value, typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass*>::type;
template<typename DOMClass, typename T> auto createWrapper(JSDOMGlobalObject*, Ref<T>&&) -> typename std::enable_if<!std::is_same<DOMClass, T>::value, typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass*>::type;

template<typename DOMClass> JSC::JSValue wrap(JSC::JSGlobalObject*, DOMWrapperWorld&, DOMClass&);
template<typename DOMClass> JSC::JSValue wrap(JSC::JSGlobalObject*, JSDOMGlobalObject*, DOMClass&);

// Inline functions and template definitions.

inline JSDOMGlobalObject* deprecatedGlobalObjectForPrototype(JSC::JSGlobalObject* lexicalGlobalObject)
{
    // FIXME: Callers to this function should be using the global object
    // from which the object is being created, instead of assuming the lexical one.
    // e.g. subframe.document.body should use the subframe's global object, not the lexical one.
    return JSC::jsCast<JSDOMGlobalObject*>(lexicalGlobalObject);
}

template<typename WrapperClass> inline JSC::Structure* getDOMStructure(JSC::VM& vm, JSDOMGlobalObject& globalObject)
{
    if (JSC::Structure* structure = getCachedDOMStructure(globalObject, WrapperClass::info()))
        return structure;
    return cacheDOMStructure(globalObject, WrapperClass::createStructure(vm, &globalObject, WrapperClass::createPrototype(vm, globalObject)), WrapperClass::info());
}

template<typename WrapperClass> inline JSC::Structure* deprecatedGetDOMStructure(JSC::JSGlobalObject* lexicalGlobalObject)
{
    // FIXME: This function is wrong. It uses the wrong global object for creating the prototype structure.
    return getDOMStructure<WrapperClass>(JSC::getVM(lexicalGlobalObject), *deprecatedGlobalObjectForPrototype(lexicalGlobalObject));
}

template<typename WrapperClass> inline JSC::JSObject* getDOMPrototype(JSC::VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSC::jsCast<JSC::JSObject*>(asObject(getDOMStructure<WrapperClass>(vm, globalObject)->storedPrototype()));
}

inline JSC::WeakHandleOwner* wrapperOwner(DOMWrapperWorld& world, JSC::ArrayBuffer*)
{
    return static_cast<WebCoreTypedArrayController*>(world.vm().m_typedArrayController.get())->wrapperOwner();
}

inline void* wrapperKey(JSC::ArrayBuffer* domObject)
{
    return domObject;
}

inline JSDOMObject* getInlineCachedWrapper(DOMWrapperWorld&, void*) { return nullptr; }
inline bool setInlineCachedWrapper(DOMWrapperWorld&, void*, JSDOMObject*, JSC::WeakHandleOwner*) { return false; }
inline bool clearInlineCachedWrapper(DOMWrapperWorld&, void*, JSDOMObject*) { return false; }

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

inline bool setInlineCachedWrapper(DOMWrapperWorld& world, ScriptWrappable* domObject, JSDOMObject* wrapper, JSC::WeakHandleOwner* wrapperOwner)
{
    if (!world.isNormal())
        return false;
    domObject->setWrapper(wrapper, wrapperOwner, &world);
    return true;
}

inline bool setInlineCachedWrapper(DOMWrapperWorld& world, JSC::ArrayBuffer* domObject, JSC::JSArrayBuffer* wrapper, JSC::WeakHandleOwner* wrapperOwner)
{
    if (!world.isNormal())
        return false;
    domObject->m_wrapper = JSC::Weak<JSC::JSArrayBuffer>(wrapper, wrapperOwner, &world);
    return true;
}

inline bool clearInlineCachedWrapper(DOMWrapperWorld& world, ScriptWrappable* domObject, JSDOMObject* wrapper)
{
    if (!world.isNormal())
        return false;
    domObject->clearWrapper(wrapper);
    return true;
}

inline bool clearInlineCachedWrapper(DOMWrapperWorld& world, JSC::ArrayBuffer* domObject, JSC::JSArrayBuffer* wrapper)
{
    if (!world.isNormal())
        return false;
    weakClear(domObject->m_wrapper, wrapper);
    return true;
}

template<typename DOMClass> inline JSC::JSObject* getCachedWrapper(DOMWrapperWorld& world, DOMClass& domObject)
{
    if (auto* wrapper = getInlineCachedWrapper(world, &domObject))
        return wrapper;
    return world.wrappers().get(wrapperKey(&domObject));
}

template<typename DOMClass, typename WrapperClass> inline void cacheWrapper(DOMWrapperWorld& world, DOMClass* domObject, WrapperClass* wrapper)
{
    JSC::WeakHandleOwner* owner = wrapperOwner(world, domObject);
    if (setInlineCachedWrapper(world, domObject, wrapper, owner))
        return;
    weakAdd(world.wrappers(), wrapperKey(domObject), JSC::Weak<JSC::JSObject>(wrapper, owner, &world));
}

template<typename DOMClass, typename WrapperClass> inline void uncacheWrapper(DOMWrapperWorld& world, DOMClass* domObject, WrapperClass* wrapper)
{
    if (clearInlineCachedWrapper(world, domObject, wrapper))
        return;
    weakRemove(world.wrappers(), wrapperKey(domObject), wrapper);
}

template<typename DOMClass, typename T> inline auto createWrapper(JSDOMGlobalObject* globalObject, Ref<T>&& domObject) -> typename std::enable_if<std::is_same<DOMClass, T>::value, typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass*>::type
{
    using WrapperClass = typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass;

    ASSERT(!getCachedWrapper(globalObject->world(), domObject));
    auto* domObjectPtr = domObject.ptr();
    auto* wrapper = WrapperClass::create(getDOMStructure<WrapperClass>(globalObject->vm(), *globalObject), globalObject, WTFMove(domObject));
    cacheWrapper(globalObject->world(), domObjectPtr, wrapper);
    return wrapper;
}

template<typename DOMClass, typename T> inline auto createWrapper(JSDOMGlobalObject* globalObject, Ref<T>&& domObject) -> typename std::enable_if<!std::is_same<DOMClass, T>::value, typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass*>::type
{
    return createWrapper<DOMClass>(globalObject, static_reference_cast<DOMClass>(WTFMove(domObject)));
}

template<typename DOMClass> inline JSC::JSValue wrap(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, DOMClass& domObject)
{
    if (auto* wrapper = getCachedWrapper(globalObject->world(), domObject))
        return wrapper;
    return toJSNewlyCreated(lexicalGlobalObject, globalObject, Ref<DOMClass>(domObject));
}

template<typename DOMClass> inline void setSubclassStructureIfNeeded(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, JSC::JSObject* jsObject)
{
    JSC::JSObject* newTarget = callFrame->newTarget().getObject();
    JSC::JSObject* constructor = callFrame->jsCallee();
    if (!newTarget || newTarget == constructor)
        return;

    using WrapperClass = typename JSDOMWrapperConverterTraits<DOMClass>::WrapperClass;

    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // If the new target isn't actually callable
    if (!newTarget->isCallable()) [[unlikely]]
        newTarget = constructor;

    auto* functionGlobalObject = JSC::getFunctionRealm(lexicalGlobalObject, newTarget);
    RETURN_IF_EXCEPTION(scope, void());
    auto* newTargetGlobalObject = defaultGlobalObject(functionGlobalObject);
    auto* baseStructure = getDOMStructure<WrapperClass>(vm, *newTargetGlobalObject);
    auto* subclassStructure = JSC::InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget, baseStructure);
    RETURN_IF_EXCEPTION(scope, void());
    jsObject->setStructure(vm, subclassStructure);
}

} // namespace WebCore
