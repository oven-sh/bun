/*
    This file is part of the WebKit open source project.

    This library is free software; you can redistribute it and/or
    modify it under the terms of the GNU Library General Public
    License as published by the Free Software Foundation; either
    version 2 of the License, or (at your option) any later version.

    This library is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
    Library General Public License for more details.

    You should have received a copy of the GNU Library General Public License
    along with this library; see the file COPYING.LIB.  If not, write to
    the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
    Boston, MA 02110-1301, USA.
*/

#pragma once

#include "root.h"

#include "DOMException.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/ErrorInstance.h>

namespace WebCore {

// A DOMException is a real JSC::ErrorInstance (so it has [[ErrorData]]: Error.isError,
// util.types.isNativeError, structured clone and the error printers all treat it as an Error),
// whose prototype is DOMException.prototype instead of Error.prototype.
//
// It adds no C++ fields, so it lives in the VM's errorInstanceSpace like every other Error;
// that is what keeps ErrorInstance's lazy stack trace machinery (unconditional finalizers)
// working for it. WebIDL wants name/message/code to be getters on the prototype backed by
// per-instance internal slots, so those three values are stored as private-name own
// properties, which JS cannot observe.
class JSDOMException final : public JSC::ErrorInstance {
public:
    using Base = JSC::ErrorInstance;

    // Captures a stack trace like `new Error()` does. `useCurrentFrame` and `subclassCaller` mean the
    // same thing as in JSC::ErrorInstance::create.
    static JSDOMException* create(JSC::VM&, JSC::Structure*, const DOMException&, JSC::JSValue cause, bool useCurrentFrame, JSC::JSCell* subclassCaller = nullptr);
    // Structured clone: reinstates the position and stack of the serialized instance instead of
    // capturing new ones, the same way a cloned Error keeps its stack.
    static JSDOMException* createWithStack(JSDOMGlobalObject&, const DOMException&, JSC::LineColumn, WTF::String&& sourceURL, WTF::String&& stack);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ErrorInstanceType, StructureFlags), info());
    }

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSDOMException, Base);
        return Base::subspaceFor<CellType, mode>(vm);
    }

    // The values captured at construction time. These never run JS, so they are usable where
    // ErrorInstance::sanitizedNameString / sanitizedMessageString would be (which only see data
    // properties, and therefore report "Error" / "" for a DOMException).
    WTF::String name() const;
    WTF::String message() const;

private:
    JSDOMException(JSC::VM&, JSC::Structure*);

    void finishCreation(JSC::VM&, const DOMException&, JSC::JSValue cause, bool useCurrentFrame, JSC::JSCell* subclassCaller);
    void finishCreation(JSC::VM&, const DOMException&, JSC::LineColumn, WTF::String&& sourceURL, WTF::String&& stack);
    void storeDescription(JSC::VM&, const DOMException&);
};

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, DOMException&);

} // namespace WebCore
