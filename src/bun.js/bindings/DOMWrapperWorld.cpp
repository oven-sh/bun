/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2004, 2005, 2006, 2007, 2008, 2009 Apple Inc. All rights reserved.
 *  Copyright (C) 2007 Samuel Weinig <sam@webkit.org>
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

#include "root.h"

#include "DOMWrapperWorld.h"

// #include "JSDOMWindow.h"
#include "WebCoreJSClientData.h"
// #include "WindowProxy.h"
#include "ZigGlobalObject.h"
#include <wtf/MainThread.h>

namespace WebCore {

using namespace JSC;

DOMWrapperWorld::DOMWrapperWorld(JSC::VM& vm, Type type, const String& name)
    : m_vm(vm)
    , m_name(name)
    , m_type(type)
{
    VM::ClientData* clientData = m_vm.clientData;
    ASSERT(clientData);
    // static_cast<JSVMClientData*>(clientData)->rememberWorld(*this);
}

DOMWrapperWorld::~DOMWrapperWorld()
{
    VM::ClientData* clientData = m_vm.clientData;
    ASSERT(clientData);
    // static_cast<JSVMClientData*>(clientData)->forgetWorld(*this);
}

void DOMWrapperWorld::clearWrappers()
{
    m_wrappers.clear();
}

DOMWrapperWorld& normalWorld(JSC::VM& vm)
{
    VM::ClientData* clientData = vm.clientData;
    ASSERT(clientData);
    return static_cast<JSVMClientData*>(clientData)->normalWorld();
}

// DOMWrapperWorld& mainThreadNormalWorld()
// {
//     ASSERT(isMainThread());
//     // static DOMWrapperWorld& cachedNormalWorld = normalWorld(commonVM());
//     return cachedNormalWorld;
// }

} // namespace WebCore
