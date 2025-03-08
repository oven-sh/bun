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

#include "config.h"
#include "DOMFormData.h"
#include "wtf/DebugHeap.h"
#include <wtf/URLParser.h>

namespace WebCore {

DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(DOMFormData);

DOMFormData::DOMFormData(ScriptExecutionContext* context)
    : ContextDestructionObserver(context)
{
}

Ref<DOMFormData> DOMFormData::create(ScriptExecutionContext* context)
{
    return adoptRef(*new DOMFormData(context));
}

Ref<DOMFormData> DOMFormData::create(ScriptExecutionContext* context, const StringView& urlEncodedString)
{
    auto newFormData = adoptRef(*new DOMFormData(context));
    for (auto& entry : WTF::URLParser::parseURLEncodedForm(urlEncodedString)) {
        newFormData->append(entry.key, entry.value);
    }

    return newFormData;
}

String DOMFormData::toURLEncodedString()
{
    WTF::URLParser::URLEncodedForm form;
    form.reserveInitialCapacity(m_items.size());
    for (auto& item : m_items) {
        if (auto value = std::get_if<String>(&item.data))
            form.append({ item.name, *value });
    }

    return WTF::URLParser::serialize(form);
}

extern "C" void DOMFormData__forEach(DOMFormData* form, void* context, void (*callback)(void* context, ZigString*, void*, ZigString*, uint8_t))
{
    for (auto& item : form->items()) {
        auto name = toZigString(item.name);
        if (auto value = std::get_if<String>(&item.data)) {
            auto value_ = toZigString(*value);
            callback(context, &name, &value_, nullptr, 0);
        } else if (auto value = std::get_if<RefPtr<Blob>>(&item.data)) {
            auto filename = toZigString(value->get()->fileName());
            callback(context, &name, value->get()->impl(), &filename, 1);
        }
    }
}

Ref<DOMFormData> DOMFormData::clone() const
{
    auto newFormData = adoptRef(*new DOMFormData(scriptExecutionContext()));
    newFormData->m_items = m_items;

    return newFormData;
}

// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#create-an-entry
static auto createStringEntry(const String& name, const String& value) -> DOMFormData::Item
{
    return {
        replaceUnpairedSurrogatesWithReplacementCharacter(String(name)),
        replaceUnpairedSurrogatesWithReplacementCharacter(String(value)),
    };
}

void DOMFormData::append(const String& name, const String& value)
{
    m_items.append(createStringEntry(name, value));
}

void DOMFormData::append(const String& name, RefPtr<Blob> blob, const String& filename)
{
    blob->setFileName(replaceUnpairedSurrogatesWithReplacementCharacter(String(filename)));
    m_items.append({ replaceUnpairedSurrogatesWithReplacementCharacter(String(name)), blob });
}
void DOMFormData::remove(const StringView name)
{
    m_items.removeAllMatching([name](const auto& item) {
        return item.name == name;
    });
}

auto DOMFormData::get(const StringView name) -> std::optional<FormDataEntryValue>
{
    for (auto& item : m_items) {
        if (item.name == name)
            return item.data;
    }

    return std::nullopt;
}

auto DOMFormData::getAll(const StringView name) -> Vector<FormDataEntryValue>
{
    Vector<FormDataEntryValue> result;

    for (auto& item : m_items) {
        if (item.name == name)
            result.append(item.data);
    }

    return result;
}

bool DOMFormData::has(const StringView name)
{
    for (auto& item : m_items) {
        if (item.name == name)
            return true;
    }

    return false;
}

void DOMFormData::set(const String& name, const String& value)
{
    set(name, { name, value });
}

void DOMFormData::set(const String& name, RefPtr<Blob> blob, const String& filename)
{
    blob->setFileName(filename);
    set(name, { name, blob });
}

void DOMFormData::set(const String& name, Item&& item)
{
    std::optional<size_t> initialMatchLocation;

    // Find location of the first item with a matching name.
    for (size_t i = 0; i < m_items.size(); ++i) {
        if (name == m_items[i].name) {
            initialMatchLocation = i;
            break;
        }
    }

    if (initialMatchLocation) {
        m_items[*initialMatchLocation] = WTFMove(item);

        m_items.removeAllMatching([&name](const auto& item) {
            return item.name == name;
        },
            *initialMatchLocation + 1);
        return;
    }

    m_items.append(WTFMove(item));
}

DOMFormData::Iterator::Iterator(DOMFormData& target)
    : m_target(target)
{
}

std::optional<KeyValuePair<String, DOMFormData::FormDataEntryValue>> DOMFormData::Iterator::next()
{
    auto& items = m_target->items();
    if (m_index >= items.size())
        return std::nullopt;

    auto& item = items[m_index++];
    return makeKeyValuePair(item.name, item.data);
}

size_t DOMFormData::memoryCost() const
{
    size_t cost = m_items.sizeInBytes();
    for (auto& item : m_items) {
        cost += item.name.sizeInBytes();
        if (auto value = std::get_if<RefPtr<Blob>>(&item.data)) {
            cost += value->get()->memoryCost();
        } else if (auto value = std::get_if<String>(&item.data)) {
            cost += value->sizeInBytes();
        }
    }

    return cost;
}

} // namespace WebCore
