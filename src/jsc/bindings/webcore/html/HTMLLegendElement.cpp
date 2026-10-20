/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
 * Copyright (C) 2018 Google Inc. All rights reserved.
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
#include "HTMLLegendElement.h"

#include "ElementIterator.h"
#include "HTMLFieldSetElement.h"
#include "HTMLNames.h"
#include "SelectionRestorationMode.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLLegendElement);

inline HTMLLegendElement::HTMLLegendElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(HTMLNames::legendTag));
}

Ref<HTMLLegendElement> HTMLLegendElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLLegendElement(tagName, document));
}

HTMLFormElement* HTMLLegendElement::form() const
{
    // According to the specification, If the legend has a fieldset element as
    // its parent, then the form attribute must return the same value as the
    // form attribute on that fieldset element. Otherwise, it must return null.
    auto* fieldset = dynamicDowncast<HTMLFieldSetElement>(parentNode());
    return fieldset ? fieldset->form() : nullptr;
}

RefPtr<HTMLFormElement> HTMLLegendElement::formForBindings() const
{
    // FIXME: The downcast should be unnecessary, but the WPT was written before https://github.com/WICG/webcomponents/issues/1072 was resolved. Update once the WPT has been updated.
    return dynamicDowncast<HTMLFormElement>(retargetReferenceTargetForBindings(form()));
}

} // namespace WebCore
