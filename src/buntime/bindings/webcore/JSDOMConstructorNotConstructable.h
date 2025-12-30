/*
 *  Copyright (C) 2015, 2016 Canon Inc. All rights reserved.
 *  Copyright (C) 2016-2021 Apple Inc. All rights reserved.
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

#include "JSDOMConstructorBase.h"
#include "ErrorCode.h"

namespace WebCore {

template<typename JSClass, Bun::ErrorCode templateErrorCode = Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR>
class JSDOMConstructorNotConstructable final : public JSDOMConstructorBase {
public:
    using Base = JSDOMConstructorBase;

    static JSDOMConstructorNotConstructable* create(JSC::VM& vm, JSC::Structure* structure, JSDOMGlobalObject& globalObject)
    {
        JSDOMConstructorNotConstructable* constructor = new (NotNull, JSC::allocateCell<JSDOMConstructorNotConstructable>(vm)) JSDOMConstructorNotConstructable(vm, structure);
        constructor->finishCreation(vm, globalObject);
        return constructor;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject& globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, &globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    DECLARE_INFO;

    // Must be defined for each specialization class.
    static JSC::JSValue prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);

private:
    JSDOMConstructorNotConstructable(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, nullptr, nullptr, templateErrorCode)
    {
    }

    void finishCreation(JSC::VM& vm, JSDOMGlobalObject& globalObject)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
        initializeProperties(vm, globalObject);
    }

    // Usually defined for each specialization class.
    void initializeProperties(JSC::VM&, JSDOMGlobalObject&) {}
};

} // namespace WebCore
