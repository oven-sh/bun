/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2001 Peter Kelly (pmk@post.com)
 *  Copyright (C) 2006-2025 Apple Inc. All rights reserved.
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

#include <JavaScriptCore/Strong.h>
#include <wtf/HashMap.h>
#include <wtf/RefCounted.h>
#include <wtf/WeakPtr.h>

namespace JSC {
class Debugger;
}

namespace WebCore {

class DOMWindow;
class DOMWrapperWorld;
class Frame;
class JSDOMGlobalObject;
class JSWindowProxy;

class WindowProxy : public RefCounted<WindowProxy> {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(WindowProxy, WEBCORE_EXPORT);
public:
    static Ref<WindowProxy> create(Frame&);
    WEBCORE_EXPORT ~WindowProxy();

    WEBCORE_EXPORT Frame* LEGACY_NODELETE frame() const;
    void detachFromFrame();
    void replaceFrame(Frame&);

    void destroyJSWindowProxy(DOMWrapperWorld&, Frame* frameForNotification = nullptr);

    Vector<JSC::Strong<JSWindowProxy>> jsWindowProxiesAsVector() const;

    WEBCORE_EXPORT JSWindowProxy* jsWindowProxy(DOMWrapperWorld&);
    WEBCORE_EXPORT JSWindowProxy* existingJSWindowProxy(DOMWrapperWorld&) const;

    WEBCORE_EXPORT JSDOMGlobalObject* globalObject(DOMWrapperWorld&);

    void clearJSWindowProxiesNotMatchingDOMWindow(DOMWindow*, bool goingIntoBackForwardCache);

    void setDOMWindow(DOMWindow*);

    // Debugger can be nullptr to detach any existing Debugger.
    void attachDebugger(JSC::Debugger*); // Attaches/detaches in all worlds/window proxies.

    WEBCORE_EXPORT DOMWindow* window() const;

private:
    explicit WindowProxy(Frame&);

    JSWindowProxy& createJSWindowProxy(DOMWrapperWorld&);
    JSWindowProxy& createJSWindowProxyWithInitializedScript(DOMWrapperWorld&);

    WeakPtr<Frame> m_frame;
    HashMap<Ref<DOMWrapperWorld>, JSC::Strong<JSWindowProxy>> m_jsWindowProxies;
};

} // namespace WebCore
