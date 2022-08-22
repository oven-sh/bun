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
#include "JavaScriptCore/InternalFunction.h"

#include "ZigGlobalObject.h"

namespace WebCore {

JSC_DECLARE_HOST_FUNCTION(callThrowTypeErrorForJSDOMConstructor);
JSC_DECLARE_HOST_FUNCTION(callThrowTypeErrorForJSDOMConstructorNotConstructable);

// Base class for all callable constructor objects in the JSC bindings.
class JSDOMConstructorBase : public JSC::InternalFunction {
public:
    using Base = InternalFunction;

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        static_assert(sizeof(CellType) == sizeof(JSDOMConstructorBase));
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(CellType, JSDOMConstructorBase);
        static_assert(CellType::destroy == JSC::JSCell::destroy, "JSDOMConstructor<JSClass> is not destructible actually");
        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    JSDOMGlobalObject* globalObject() const { return JSC::jsCast<JSDOMGlobalObject*>(Base::globalObject()); }
    ScriptExecutionContext* scriptExecutionContext() const { return globalObject()->scriptExecutionContext(); }

protected:
    JSDOMConstructorBase(JSC::VM& vm, JSC::Structure* structure, JSC::NativeFunction functionForConstruct)
        : Base(vm, structure,
            functionForConstruct ? functionForConstruct : callThrowTypeErrorForJSDOMConstructorNotConstructable,
            functionForConstruct ? functionForConstruct : callThrowTypeErrorForJSDOMConstructorNotConstructable)
    {
    }
};

} // namespace WebCore
