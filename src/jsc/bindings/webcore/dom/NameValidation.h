/*
 * Copyright (C) 2025 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <utility>
#include <wtf/Forward.h>

namespace WebCore {

class QualifiedName;
template<typename> class ExceptionOr;

// https://dom.spec.whatwg.org/#validate-and-extract
namespace NameValidation {

// https://dom.spec.whatwg.org/#valid-element-name
bool LEGACY_NODELETE isValidElementName(StringView);
bool isValidElementName(const QualifiedName&);

// https://dom.spec.whatwg.org/#valid-attribute-name
bool LEGACY_NODELETE isValidAttributeName(StringView);

// https://dom.spec.whatwg.org/#valid-doctype-name
bool LEGACY_NODELETE isValidDoctypeName(StringView);

// https://www.w3.org/TR/xml/#NT-Name - used by createProcessingInstruction
bool LEGACY_NODELETE isValidXMLName(StringView);

ExceptionOr<QualifiedName> parseQualifiedElementName(const AtomString& namespaceURI, const AtomString& qualifiedName);
ExceptionOr<QualifiedName> parseQualifiedAttributeName(const AtomString& namespaceURI, const AtomString& qualifiedName);
ExceptionOr<std::pair<AtomString, AtomString>> parseQualifiedAttributeName(const AtomString& qualifiedName);

bool LEGACY_NODELETE hasValidNamespaceForElements(const QualifiedName&);
bool LEGACY_NODELETE hasValidNamespaceForAttributes(const QualifiedName&);

} // namespace NameValidation

} // namespace WebCore
