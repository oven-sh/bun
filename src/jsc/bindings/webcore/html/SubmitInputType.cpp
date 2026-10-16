/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2011-2025 Apple Inc. All rights reserved.
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
#include "SubmitInputType.h"

#include "DOMFormData.h"
#include "Document.h"
#include "ElementInlines.h"
#include "Event.h"
#include "HTMLFormElement.h"
#include "HTMLInputElement.h"
#include "InputTypeNames.h"
#include "LocalizedStrings.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SubmitInputType);

using namespace HTMLNames;

const AtomString& SubmitInputType::formControlType() const
{
    return InputTypeNames::submit();
}

bool SubmitInputType::appendFormData(DOMFormData& formData) const
{
    ASSERT(element());
    Ref element = *this->element();
    if (!element->isActivatedSubmit())
        return false;
    formData.append(element->name(), element->valueWithDefault());
    if (auto& dirname = element->attributeWithoutSynchronization(HTMLNames::dirnameAttr); !dirname.isNull())
        formData.append(dirname, element->directionForFormData());
    return true;
}

bool SubmitInputType::supportsRequired() const
{
    return false;
}

void SubmitInputType::handleDOMActivateEvent(Event& event)
{
    ASSERT(element());
    Ref element = *this->element();
    if (element->isDisabledFormControl() || !element->form())
        return;

    Ref protectedForm = *element->form();

    if (RefPtr currentForm = element->form())
        currentForm->submitIfPossible(&event, element.ptr()); // Event handlers can run.
    event.setDefaultHandled();
}

bool SubmitInputType::canBeSuccessfulSubmitButton()
{
    return true;
}

String SubmitInputType::defaultValue() const
{
    return submitButtonDefaultLabel();
}

} // namespace WebCore
