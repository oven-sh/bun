/*
 *  Copyright (C) 2015, 2016 Canon Inc. All rights reserved.
 *  Copyright (C) 2016-2022 Apple Inc. All rights reserved.
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

#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/InternalFunction.h>

#include "ZigGlobalObject.h"
#include "ErrorCode.h"

namespace WebCore {

class Document;
class Window;

JSC_DECLARE_HOST_FUNCTION(callThrowTypeErrorForJSDOMConstructor);
// Interfaces that cannot be constructed at all report "Illegal constructor" for
// both call and construct; the message above only makes sense for a constructable
// interface invoked without `new`.
JSC_DECLARE_HOST_FUNCTION(throwTypeErrorForJSDOMConstructorNotConstructable);

// Base class for all callable constructor objects in the JSC bindings.
class JSDOMConstructorBase : public JSC::InternalFunction {
public:
    using Base = InternalFunction;

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = DoesNotNeedDestruction;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        static_assert(sizeof(CellType) == sizeof(JSDOMConstructorBase));
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(CellType, JSDOMConstructorBase);
        static_assert(CellType::destroy == JSC::JSCell::destroy, "JSDOMConstructor<JSClass> is not destructible actually");
        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    JSDOMGlobalObject* globalObject() const { return uncheckedDowncast<JSDOMGlobalObject>(Base::globalObject()); }
    JSDOMGlobalObject* realm() const { return uncheckedDowncast<JSDOMGlobalObject>(Base::realm()); }
    // What the constructor makes belongs to the context the calling script runs in.
    ScriptExecutionContext* scriptExecutionContext() const { return globalObject()->currentScriptExecutionContext(); }
    Bun::ErrorCode errorCode() const { return m_errorCode; }

    // Every `bun:dom` window has its own copy of a constructor that needs "the current document" (`new window.Text()`).
    // The copies share `prototype`. The constructor cached on the global object belongs to no window.
    static JSDOMConstructorBase* createForWindow(JSC::VM&, JSDOMConstructorBase& constructor, Window&, JSC::JSObject& windowWrapper);
    Window* window() const { return m_window; }
    Document* document() const;

    DECLARE_VISIT_CHILDREN;

    // The `length` / `name` / `prototype` prologue shared by every `initializeProperties`.
    void initializeBaseProperties(JSC::VM&, unsigned length, ASCIILiteral name, JSC::JSObject* prototype);

protected:
    JSDOMConstructorBase(JSC::VM& vm, JSC::Structure* structure,
        JSC::NativeFunction functionForConstruct,
        JSC::NativeFunction functionForCall = nullptr,
        Bun::ErrorCode errorCode = Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR)
        : Base(vm, structure,
              functionForCall ? functionForCall : callThrowTypeErrorForJSDOMConstructor,
              functionForConstruct ? functionForConstruct : callThrowTypeErrorForJSDOMConstructor)
        , m_errorCode(errorCode)
    {
    }

    Bun::ErrorCode m_errorCode;

private:
    // The wrapper keeps the window alive.
    Window* m_window { nullptr };
    JSC::WriteBarrier<JSC::JSObject> m_windowWrapper;
};

} // namespace WebCore
