/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "ContextDestructionObserver.h"
#include <variant>
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>
#include "blob.h"

namespace WebCore {

class ScriptExecutionContext;

template<typename> class ExceptionOr;
class HTMLElement;
class HTMLFormElement;
DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(DOMFormData);

class DOMFormData : public RefCounted<DOMFormData>, public ContextDestructionObserver {
    WTF_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(DOMFormData);

public:
    using FormDataEntryValue = std::variant<String, RefPtr<Blob>>;

    struct Item {
        String name;
        FormDataEntryValue data;
    };

    // static Ref<DOMFormData> create(ScriptExecutionContext*, const PAL::TextEncoding&);
    static Ref<DOMFormData> create(ScriptExecutionContext*);
    static Ref<DOMFormData> create(ScriptExecutionContext*, const StringView& urlEncodedString);

    const Vector<Item>& items() const { return m_items; }
    // const PAL::TextEncoding& encoding() const { return m_encoding; }

    void append(const String& name, const String& value);
    void append(const String& name, RefPtr<Blob>, const String& filename = {});
    void remove(const StringView name);
    std::optional<FormDataEntryValue> get(const StringView name);
    Vector<FormDataEntryValue> getAll(const StringView name);
    bool has(const StringView name);
    void set(const String& name, const String& value);
    void set(const String& name, RefPtr<Blob>, const String& filename = {});
    Ref<DOMFormData> clone() const;

    size_t count() const { return m_items.size(); }
    size_t memoryCost() const;

    String toURLEncodedString();

    class Iterator {
    public:
        explicit Iterator(DOMFormData&);
        std::optional<KeyValuePair<String, FormDataEntryValue>> next();

    private:
        Ref<DOMFormData> m_target;
        size_t m_index { 0 };
    };
    Iterator createIterator() { return Iterator { *this }; }
    Iterator createIterator(const ScriptExecutionContext* context) { return Iterator { *this }; }

private:
    // explicit DOMFormData(ScriptExecutionContext*, const PAL::TextEncoding& = PAL::UTF8Encoding());
    explicit DOMFormData(ScriptExecutionContext*);

    void set(const String& name, Item&&);

    // PAL::TextEncoding m_encoding;
    Vector<Item> m_items;
};

} // namespace WebCore
