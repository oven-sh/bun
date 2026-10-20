/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2004-2022 Apple Inc. All rights reserved.
 *  Copyright (C) 2007 Samuel Weinig <sam@webkit.org>
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

#include "config.h"

#include "JSDOMConstructor.h"

#include "WebCoreJSClientData.h"
#include "ErrorCode.h"
#include "Window.h"
#include <JavaScriptCore/PropertyNameArray.h>

namespace WebCore {
using namespace JSC;

STATIC_ASSERT_IS_TRIVIALLY_DESTRUCTIBLE(JSDOMConstructorBase);

JSC_DEFINE_HOST_FUNCTION(callThrowTypeErrorForJSDOMConstructor, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* callee = callframe->jsCallee();
    auto* constructor = dynamicDowncast<JSDOMConstructorBase>(callee);
    const auto& name = constructor->name();
    Bun::throwError(globalObject, scope, constructor->errorCode(), makeString("Use `new "_s, name, "(...)` instead of `"_s, name, "(...)`"_s));
    return {};
}

JSC_DEFINE_HOST_FUNCTION(throwTypeErrorForJSDOMConstructorNotConstructable, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* callee = callframe->jsCallee();
    auto* constructor = dynamicDowncast<JSDOMConstructorBase>(callee);
    // The message belongs to the error code: interfaces opting into a non-default
    // code (MessagePort -> ERR_CONSTRUCT_CALL_INVALID) carry Node's wording for it.
    auto errorCode = constructor->errorCode();
    auto message = errorCode == Bun::ErrorCode::ERR_CONSTRUCT_CALL_INVALID
        ? "Constructor cannot be called"_s
        : "Illegal constructor"_s;
    Bun::throwError(globalObject, scope, errorCode, message);
    return {};
}

JSC::GCClient::IsoSubspace* JSDOMConstructorBase::subspaceForImpl(JSC::VM& vm)
{
    return &static_cast<JSVMClientData*>(vm.clientData)->domConstructorSpace();
}

Document* JSDOMConstructorBase::document() const
{
    return m_window ? m_window->document() : nullptr;
}

JSDOMConstructorBase* JSDOMConstructorBase::createForWindow(VM& vm, JSDOMConstructorBase& constructor, Window& window, JSObject& windowWrapper)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = constructor.globalObject();

    // Every JSDOMConstructor<T> has JSDOMConstructorBase's layout (see subspaceFor()), and the Structure carries T's ClassInfo.
    auto* structure = Structure::create(vm, globalObject, constructor.getPrototypeDirect(), constructor.structure()->typeInfo(), constructor.classInfo());
    auto* copy = new (NotNull, allocateCell<JSDOMConstructorBase>(vm)) JSDOMConstructorBase(vm, structure, nullptr, nullptr, constructor.m_errorCode);
    copy->Base::finishCreation(vm);
    copy->m_functionForCall = constructor.m_functionForCall;
    copy->m_functionForConstruct = constructor.m_functionForConstruct;
    copy->m_window = &window;
    copy->m_windowWrapper.set(vm, copy, &windowWrapper);
    copy->m_originalName.set(vm, copy, constructor.m_originalName.get());

    PropertyNameArrayBuilder names(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Include);
    JSObject::getOwnPropertyNames(&constructor, globalObject, names, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, nullptr);
    for (auto& name : names) {
        unsigned attributes = 0;
        JSValue value = constructor.getDirect(vm, name, attributes);
        if (!value)
            continue;
        if (attributes & PropertyAttribute::CustomAccessorOrValue)
            copy->putDirectCustomAccessor(vm, name, value, attributes);
        else if (attributes & PropertyAttribute::Accessor)
            copy->putDirectNonIndexAccessor(vm, name, uncheckedDowncast<GetterSetter>(value), attributes);
        else
            copy->putDirect(vm, name, value, attributes);
    }
    return copy;
}

template<typename Visitor>
void JSDOMConstructorBase::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDOMConstructorBase>(cell);
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_windowWrapper);
}

DEFINE_VISIT_CHILDREN(JSDOMConstructorBase);

void JSDOMConstructorBase::initializeBaseProperties(JSC::VM& vm, unsigned length, ASCIILiteral name, JSC::JSObject* prototype)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(length), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, String(name));
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

} // namespace WebCore
