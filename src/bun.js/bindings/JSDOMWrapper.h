/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2003-2018 Apple Inc. All rights reserved.
 *  Copyright (C) 2007 Samuel Weinig <sam@webkit.org>
 *  Copyright (C) 2009 Google, Inc. All rights reserved.
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
#include "root.h"
#include "ZigGlobalObject.h"

#include "JSDOMGlobalObject.h"
#include "NodeConstants.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <wtf/SignedPtr.h>

namespace WebCore {
using namespace Zig;
#ifndef RENAMED_JSDOM_GLOBAL_OBJECT
#define RENAMED_JSDOM_GLOBAL_OBJECT
using JSDOMGlobalObject = Zig::GlobalObject;
}
#endif
class ScriptExecutionContext;

// JSC allows us to extend JSType. If the highest 3 bits are set, we can add any Object types and they are
// recognized as OtherObj in JSC. And we encode Node type into JSType if the given JSType is subclass of Node.
// offset | 7 | 6 | 5 | 4   3   2   1   0  |
// value  | 1 | 1 | 1 | Non-node DOM types |
// If the given JSType is a subclass of Node, the format is the following.
// offset | 7 | 6 | 5 | 4 | 3   2   1   0  |
// value  | 1 | 1 | 1 | 1 |    NodeType    |

static const uint8_t JSDOMWrapperType = 0b11101110;
static const uint8_t JSEventType = 0b11101111;
static const uint8_t JSNodeType = 0b11110000;
static const uint8_t JSNodeTypeMask = 0b00001111;
static const uint8_t JSTextNodeType = JSNodeType | NodeConstants::TEXT_NODE;
static const uint8_t JSProcessingInstructionNodeType = JSNodeType | NodeConstants::PROCESSING_INSTRUCTION_NODE;
static const uint8_t JSDocumentTypeNodeType = JSNodeType | NodeConstants::DOCUMENT_TYPE_NODE;
static const uint8_t JSDocumentFragmentNodeType = JSNodeType | NodeConstants::DOCUMENT_FRAGMENT_NODE;
static const uint8_t JSDocumentWrapperType = JSNodeType | NodeConstants::DOCUMENT_NODE;
static const uint8_t JSCommentNodeType = JSNodeType | NodeConstants::COMMENT_NODE;
static const uint8_t JSCDATASectionNodeType = JSNodeType | NodeConstants::CDATA_SECTION_NODE;
static const uint8_t JSAttrNodeType = JSNodeType | NodeConstants::ATTRIBUTE_NODE;
static const uint8_t JSElementType = 0b11110000 | NodeConstants::ELEMENT_NODE;
static const uint8_t JSAsJSONType = JSElementType;

static_assert(JSDOMWrapperType > JSC::LastJSCObjectType, "JSC::JSType offers the highest bit.");
static_assert(NodeConstants::LastNodeType <= JSNodeTypeMask, "NodeType should be represented in 4bit.");

class JSDOMObject : public JSC::JSDestructibleObject {
public:
    typedef JSC::JSDestructibleObject Base;

    template<typename, JSC::SubspaceAccess>
    static void subspaceFor(JSC::VM&) { RELEASE_ASSERT_NOT_REACHED(); }

    JSDOMGlobalObject* globalObject() const { return JSC::jsCast<JSDOMGlobalObject*>(JSC::JSNonFinalObject::globalObject()); }
    ScriptExecutionContext* scriptExecutionContext() const { return globalObject()->scriptExecutionContext(); }

protected:
    WEBCORE_EXPORT JSDOMObject(JSC::Structure*, JSC::JSGlobalObject&);
};

template<typename ImplementationClass, typename PtrTraits = RawPtrTraits<ImplementationClass>>
class JSDOMWrapper : public JSDOMObject {
public:
    using Base = JSDOMObject;
    using DOMWrapped = ImplementationClass;

    ImplementationClass& wrapped() const { return m_wrapped; }
    static ptrdiff_t offsetOfWrapped() { return OBJECT_OFFSETOF(JSDOMWrapper, m_wrapped); }
    constexpr static bool hasCustomPtrTraits() { return !std::is_same_v<PtrTraits, RawPtrTraits<ImplementationClass>>; };

protected:
    JSDOMWrapper(JSC::Structure* structure, JSC::JSGlobalObject& globalObject, Ref<ImplementationClass>&& impl)
        : Base(structure, globalObject)
        , m_wrapped(WTFMove(impl))
    {
    }

private:
    Ref<ImplementationClass, PtrTraits> m_wrapped;
};

template<typename ImplementationClass> struct JSDOMWrapperConverterTraits;

JSC::JSValue cloneAcrossWorlds(JSC::JSGlobalObject&, const JSDOMObject& owner, JSC::JSValue);

} // namespace WebCore
