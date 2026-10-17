/*
 * Copyright (C) 2015-2025 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <JavaScriptCore/JSGlobalObject.h>
#include "CustomElementFormValue.h"
#include "DOMClientData.h"
#include "Element.h"
#include "GCReachableRef.h"
#include "QualifiedName.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/CheckedRef.h>
#include <wtf/Forward.h>
#include <wtf/Noncopyable.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/text/AtomString.h>

namespace JSC {

class CallFrame;

}

namespace WebCore {

class CustomElementQueue;
class Document;
class Element;
class HTMLFormElement;
class JSCustomElementInterface;

class CustomElementReactionQueueItem {
    WTF_MAKE_TZONE_ALLOCATED(CustomElementReactionQueueItem);
    WTF_MAKE_NONCOPYABLE(CustomElementReactionQueueItem);
public:
    enum class Type : uint8_t {
        Invalid,
        ElementUpgrade,
        Connected,
        Disconnected,
        ConnectedMove,
        Adopted,
        AttributeChanged,
        FormAssociated,
        FormReset,
        FormDisabled,
        FormStateRestore,
    };

    struct AdoptedPayload {
        Ref<Document> oldDocument;
        Ref<Document> newDocument;
        ~AdoptedPayload();
    };

    struct FormAssociatedPayload {
        RefPtr<HTMLFormElement> form;
        ~FormAssociatedPayload();
    };

    using AttributeChangedPayload = std::tuple<QualifiedName, AtomString, AtomString>;
    using FormDisabledPayload = bool;
    using FormStateRestorePayload = CustomElementFormValue;
    using Payload = std::optional<Variant<AdoptedPayload, AttributeChangedPayload, FormAssociatedPayload, FormDisabledPayload, FormStateRestorePayload>>;

    CustomElementReactionQueueItem();
    CustomElementReactionQueueItem(CustomElementReactionQueueItem&&);
    CustomElementReactionQueueItem(Type, Payload = std::nullopt);
    ~CustomElementReactionQueueItem();
    Type type() const { return m_type; }
    void invoke(Element&, JSCustomElementInterface&);

private:
    Type m_type { Type::Invalid };
    Payload m_payload;
};

// https://html.spec.whatwg.org/multipage/custom-elements.html#element-queue
class CustomElementQueue {
    WTF_MAKE_TZONE_ALLOCATED(CustomElementQueue);
    WTF_MAKE_NONCOPYABLE(CustomElementQueue);
public:
    CustomElementQueue() = default;
    ~CustomElementQueue() { ASSERT(isEmpty()); }

    bool isEmpty() const { return m_elements.isEmpty(); }
    void add(Element&);
    WEBCORE_EXPORT void processQueue(JSC::JSGlobalObject*);

    Vector<Ref<Element>, 4> takeElements();

private:
    void invokeAll();

    Vector<Ref<Element>, 4> m_elements;
    bool m_invoking { false };
};

class CustomElementReactionQueue final : public CanMakeCheckedPtr<CustomElementReactionQueue> {
    WTF_MAKE_TZONE_ALLOCATED(CustomElementReactionQueue);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(CustomElementReactionQueue);
    WTF_MAKE_NONCOPYABLE(CustomElementReactionQueue);
public:
    CustomElementReactionQueue(JSCustomElementInterface&);
    ~CustomElementReactionQueue();

    static void enqueueElementUpgrade(Element&, bool alreadyScheduledToUpgrade);
    static bool tryToUpgradeElement(Element&);
    static void enqueueConnectedCallbackIfNeeded(Element&);
    static void enqueueDisconnectedCallbackIfNeeded(Element&);
    static void enqueueConnectedMoveCallbackIfNeeded(Element&);
    static void enqueueAdoptedCallbackIfNeeded(Element&, Document& oldDocument, Document& newDocument);
    static void enqueueAttributeChangedCallbackIfNeeded(Element&, const QualifiedName&, const AtomString& oldValue, const AtomString& newValue);
    static void enqueueFormAssociatedCallbackIfNeeded(Element&, HTMLFormElement*);
    static void enqueueFormDisabledCallbackIfNeeded(Element&, bool isDisabled);
    static void enqueueFormResetCallbackIfNeeded(Element&);
    static void enqueueFormStateRestoreCallbackIfNeeded(Element&, CustomElementFormValue&&);
    static void enqueuePostUpgradeReactions(Element&);

    bool LEGACY_NODELETE observesStyleAttribute() const;
    bool LEGACY_NODELETE isElementInternalsDisabled() const;
    bool isElementInternalsAttached() const { return m_elementInternalsAttached; }
    void LEGACY_NODELETE setElementInternalsAttached();
    bool LEGACY_NODELETE isFormAssociated() const;
    bool LEGACY_NODELETE hasFormStateRestoreCallback() const;

    void invokeAll(Element&);
    void clear();
    bool isEmpty() const { return m_items.isEmpty(); }
#if ASSERT_ENABLED
    bool hasJustUpgradeReaction() const;
#endif

    static void processBackupQueue(CustomElementQueue&);

    static void enqueueElementsOnAppropriateElementQueue(const Vector<Ref<Element>>&);

private:
    static void enqueueElementOnAppropriateElementQueue(Element&);

    using Item = CustomElementReactionQueueItem;

    const Ref<JSCustomElementInterface> m_interface;
    Vector<Item, 1> m_items;
    bool m_elementInternalsAttached { false };
};

class CustomElementReactionDisallowedScope {
public:
    CustomElementReactionDisallowedScope()
    {
#if ASSERT_ENABLED
        domClientData().customElementReactionDisallowedCount()++;
#endif
    }

    ~CustomElementReactionDisallowedScope()
    {
#if ASSERT_ENABLED
        ASSERT(domClientData().customElementReactionDisallowedCount());
        domClientData().customElementReactionDisallowedCount()--;
#endif
    }

#if ASSERT_ENABLED
    static bool isReactionAllowed() { return !domClientData().customElementReactionDisallowedCount(); }
#endif

    class AllowedScope {
#if ASSERT_ENABLED
    public:
        AllowedScope()
            : m_originalCount(domClientData().customElementReactionDisallowedCount())
        {
            domClientData().customElementReactionDisallowedCount() = 0;
        }

        ~AllowedScope()
        {
            domClientData().customElementReactionDisallowedCount() = m_originalCount;
        }

    private:
        unsigned m_originalCount;
#endif // ASSERT_ENABLED
    };
};

class CustomElementReactionStack : public CustomElementReactionDisallowedScope::AllowedScope {
public:
    ALWAYS_INLINE CustomElementReactionStack(JSC::JSGlobalObject* state)
        : m_currentProcessingStack(domClientData(state->vm()).customElementReactionStack())
        , m_previousProcessingStack(m_currentProcessingStack)
        , m_state(state)
    {
        m_currentProcessingStack = this;
    }

    ALWAYS_INLINE CustomElementReactionStack(JSC::JSGlobalObject& state)
        : CustomElementReactionStack(&state)
    { }

    ALWAYS_INLINE ~CustomElementReactionStack()
    {
        if (!m_queue.isEmpty()) [[unlikely]]
            m_queue.processQueue(m_state);
        m_currentProcessingStack = m_previousProcessingStack;
    }

    Vector<Ref<Element>, 4> takeElements() { return m_queue.takeElements(); }

private:
    CustomElementQueue m_queue;
    CustomElementReactionStack*& m_currentProcessingStack;
    CustomElementReactionStack* const m_previousProcessingStack;
    JSC::JSGlobalObject* const m_state;

    friend CustomElementReactionQueue;
};

}
