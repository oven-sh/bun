/*
 * (C) 1999-2003 Lars Knoll (knoll@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2008, 2012 Apple Inc. All rights reserved.
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
 */

#pragma once

#include "ScriptWrappable.h"
#include <wtf/AbstractRefCountedAndCanMakeWeakPtr.h>
#include <wtf/CheckedRef.h>

namespace WebCore {

class CSSRule;
class StyledElement;

template<typename> class ExceptionOr;

enum class StyleDeclarationType : uint8_t {
    Style
};

class CSSStyleDeclaration : public ScriptWrappable, public AbstractRefCountedAndCanMakeSingleThreadWeakPtr<CSSStyleDeclaration> {
    WTF_MAKE_NONCOPYABLE(CSSStyleDeclaration);
    WTF_MAKE_TZONE_ALLOCATED(CSSStyleDeclaration);
public:
    virtual ~CSSStyleDeclaration();

    virtual StyleDeclarationType styleDeclarationType() const = 0;

    virtual StyledElement* parentElement() const { return nullptr; }
    virtual CSSRule* parentRule() const = 0;
    virtual String cssText() const = 0;
    virtual ExceptionOr<void> setCssText(const String&) = 0;
    virtual unsigned length() const = 0;
    virtual String item(unsigned index) const = 0;
    bool isSupportedPropertyIndex(unsigned index) const { return index < length(); }
    virtual String getPropertyValue(const String& propertyName) = 0;
    virtual String getPropertyPriority(const String& propertyName) = 0;
    virtual ExceptionOr<void> setProperty(const String& propertyName, const String& value, const String& priority) = 0;
    virtual ExceptionOr<String> removeProperty(const String& propertyName) = 0;

protected:
    CSSStyleDeclaration() = default;
};

} // namespace WebCore

#define SPECIALIZE_TYPE_TRAITS_CSS_STYLE_DECLARATION(ToValueTypeName, predicate) \
SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ToValueTypeName) \
    static bool isType(const WebCore::CSSStyleDeclaration& declaration) { return declaration.styleDeclarationType() == WebCore::predicate; } \
SPECIALIZE_TYPE_TRAITS_END()
