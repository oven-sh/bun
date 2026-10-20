/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 * Copyright (C) 2013-2017 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
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
#include "UserActionElementSet.h"

#include "Element.h"

namespace WebCore {

void UserActionElementSet::clear()
{
    for (auto iterator = m_elements.begin(); iterator != m_elements.end(); ++iterator)
        iterator->key.setUserActionElement(false);
    m_elements.clear();
}

bool UserActionElementSet::hasFlag(const Element& element, Flag flag) const
{
    // Caller has the responsibility to check isUserActionElement before calling this.
    ASSERT(element.isUserActionElement());

    return m_elements.get(element).contains(flag);
}

void UserActionElementSet::clearFlags(Element& element, OptionSet<Flag> flags)
{
    ASSERT(!flags.isEmpty());

    if (!element.isUserActionElement())
        return;

    auto iterator = m_elements.find(element);
    ASSERT(iterator != m_elements.end());
    auto updatedFlags = iterator->value - flags;
    if (updatedFlags.isEmpty()) {
        element.setUserActionElement(false);
        m_elements.remove(iterator);
    } else
        iterator->value = updatedFlags;
}

void UserActionElementSet::setFlags(Element& element, OptionSet<Flag> flags)
{
    ASSERT(!flags.isEmpty());

    m_elements.ensure(element, [] {
        return OptionSet<Flag>();
    }).iterator->value.add(flags);

    element.setUserActionElement(true);
}

}
