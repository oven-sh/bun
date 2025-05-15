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

namespace WebCore {
using namespace JSC;

STATIC_ASSERT_IS_TRIVIALLY_DESTRUCTIBLE(JSDOMConstructorBase);

JSC_DEFINE_HOST_FUNCTION(callThrowTypeErrorForJSDOMConstructor, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* callee = callframe->jsCallee();
    auto* constructor = jsDynamicCast<JSDOMConstructorBase*>(callee);
    const auto& name = constructor->name();
    RETURN_IF_EXCEPTION(scope, {});
    Bun::throwError(globalObject, scope, constructor->errorCode(), makeString("Use `new "_s, name, "(...)` instead of `"_s, name, "(...)`"_s));
    return {};
}

JSC::GCClient::IsoSubspace* JSDOMConstructorBase::subspaceForImpl(JSC::VM& vm)
{
    return &static_cast<JSVMClientData*>(vm.clientData)->domConstructorSpace();
}

} // namespace WebCore
