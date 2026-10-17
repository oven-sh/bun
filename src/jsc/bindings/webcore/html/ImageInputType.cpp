/*
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2012 Samsung Electronics. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 */

#include "config.h"
#include "ImageInputType.h"

#include "ContainerNodeInlines.h"
#include "DOMFormData.h"
#include "ElementInlines.h"
#include "HTMLFormElement.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "InputTypeNames.h"
#include "MouseEvent.h"
#include <wtf/NeverDestroyed.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ImageInputType);

using namespace HTMLNames;

ImageInputType::ImageInputType(HTMLInputElement& element)
    : BaseButtonInputType(Type::Image, element)
{
}

const AtomString& ImageInputType::formControlType() const
{
    return InputTypeNames::image();
}

bool ImageInputType::isFormDataAppendable() const
{
    return true;
}

bool ImageInputType::appendFormData(DOMFormData& formData) const
{
    ASSERT(element());
    Ref element = *this->element();
    if (!element->isActivatedSubmit())
        return false;

    auto& name = element->name();
    if (name.isEmpty()) {
        formData.append("x"_s, String::number(m_clickLocation.x));
        formData.append("y"_s, String::number(m_clickLocation.y));
        return true;
    }

    formData.append(makeString(name, ".x"_s), String::number(m_clickLocation.x));
    formData.append(makeString(name, ".y"_s), String::number(m_clickLocation.y));

    return true;
}

void ImageInputType::handleDOMActivateEvent(Event& event)
{
    ASSERT(element());
    Ref element = *this->element();
    if (element->isDisabledFormControl() || !element->form())
        return;

    Ref protectedForm = *element->form();

    m_clickLocation = { };
    if (RefPtr mouseEvent = dynamicDowncast<MouseEvent>(event.underlyingEvent())) {
        if (!mouseEvent->isSimulated())
            m_clickLocation = { static_cast<int>(mouseEvent->offsetX()), static_cast<int>(mouseEvent->offsetY()) };
    }

    if (RefPtr currentForm = element->form())
        currentForm->submitIfPossible(&event, element.ptr()); // Event handlers can run.

    event.setDefaultHandled();
}

bool ImageInputType::canBeSuccessfulSubmitButton()
{
    return true;
}

unsigned ImageInputType::height() const
{
    ASSERT(element());
    Ref element = *this->element();

    if (auto optionalHeight = parseHTMLNonNegativeInteger(element->attributeWithoutSynchronization(heightAttr)))
        return optionalHeight.value();

    return 0;
}

unsigned ImageInputType::width() const
{
    ASSERT(element());
    Ref element = *this->element();

    if (auto optionalWidth = parseHTMLNonNegativeInteger(element->attributeWithoutSynchronization(widthAttr)))
        return optionalWidth.value();

    return 0;
}

String ImageInputType::resultForDialogSubmit() const
{
    return makeString(m_clickLocation.x, ',', m_clickLocation.y);
}

bool ImageInputType::dirAutoUsesValue() const
{
    return false;
}

} // namespace WebCore
