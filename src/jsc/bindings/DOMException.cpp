/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY GOOGLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "root.h"
#include "DOMException.h"

#include "Exception.h"

namespace WebCore {

// This array needs to be kept in sync with the ExceptionCode enumeration.
// http://heycam.github.io/webidl/#idl-DOMException-error-names
static const DOMException::Description descriptions[] = {
    { "IndexSizeError"_s, "The index is not in the allowed range."_s, 1 },
    { "HierarchyRequestError"_s, "The operation would yield an incorrect node tree."_s, 3 },
    { "WrongDocumentError"_s, "The object is in the wrong document."_s, 4 },
    { "InvalidCharacterError"_s, "The string contains invalid characters."_s, 5 },
    { "NoModificationAllowedError"_s, "The object can not be modified."_s, 7 },
    { "NotFoundError"_s, "The object can not be found here."_s, 8 },
    { "NotSupportedError"_s, "The operation is not supported."_s, 9 },
    { "InUseAttributeError"_s, "The attribute is in use."_s, 10 },
    { "InvalidStateError"_s, "The object is in an invalid state."_s, 11 },
    { "SyntaxError"_s, "The string did not match the expected pattern."_s, 12 },
    { "InvalidModificationError"_s, " The object can not be modified in this way."_s, 13 },
    { "NamespaceError"_s, "The operation is not allowed by Namespaces in XML."_s, 14 },
    { "InvalidAccessError"_s, "The object does not support the operation or argument."_s, 15 },
    { "TypeMismatchError"_s, "The type of an object was incompatible with the expected type of the parameter associated to the object."_s, 17 },
    { "SecurityError"_s, "The operation is insecure."_s, 18 },
    { "NetworkError"_s, " A network error occurred."_s, 19 },
    { "AbortError"_s, "The operation was aborted."_s, 20 },
    { "URLMismatchError"_s, "The given URL does not match another URL."_s, 21 },
    { "QuotaExceededError"_s, "The quota has been exceeded."_s, 22 },
    { "TimeoutError"_s, "The operation timed out."_s, 23 },
    { "InvalidNodeTypeError"_s, "The supplied node is incorrect or has an incorrect ancestor for this operation."_s, 24 },
    { "DataCloneError"_s, "The object can not be cloned."_s, 25 },
    { "EncodingError"_s, "The encoding operation (either encoded or decoding) failed."_s, 0 },
    { "NotReadableError"_s, "The I/O read operation failed."_s, 0 },
    { "UnknownError"_s, "The operation failed for an unknown transient reason (e.g. out of memory)."_s, 0 },
    { "ConstraintError"_s, "A mutation operation in a transaction failed because a constraint was not satisfied."_s, 0 },
    { "DataError"_s, "Provided data is inadequate."_s, 0 },
    { "TransactionInactiveError"_s, "A request was placed against a transaction which is currently not active, or which is finished."_s, 0 },
    { "ReadOnlyError"_s, "The mutating operation was attempted in a \"readonly\" transaction."_s, 0 },
    { "VersionError"_s, "An attempt was made to open a database using a lower version than the existing version."_s, 0 },
    { "OperationError"_s, "The operation failed for an operation-specific reason."_s, 0 },
    { "NotAllowedError"_s, "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission."_s, 0 }
};
static_assert(!IndexSizeError, "This table needs to be kept in sync with DOMException names in ExceptionCode enumeration");
static_assert(NotAllowedError == std::size(descriptions) - 1, "This table needs to be kept in sync with DOMException names in ExceptionCode enumeration");

auto DOMException::description(ExceptionCode ec) -> const Description&
{
    if (ec < std::size(descriptions))
        return descriptions[ec];

    static const Description emptyDescription { {}, {}, 0 };
    return emptyDescription;
}

static DOMException::LegacyCode legacyCodeFromName(const String& name)
{
    for (auto& description : descriptions) {
        if (description.name == name)
            return description.legacyCode;
    }
    return 0;
}

Ref<DOMException> DOMException::create(ExceptionCode ec, const String& message)
{
    auto& description = DOMException::description(ec);
    return adoptRef(*new DOMException(description.legacyCode, description.name, !message.isEmpty() ? message : description.message));
}

Ref<DOMException> DOMException::create(const String& message, const String& name)
{
    return adoptRef(*new DOMException(legacyCodeFromName(name), name, message));
}

Ref<DOMException> DOMException::create(const Exception& exception)
{
    auto& description = DOMException::description(exception.code());
    return adoptRef(*new DOMException(description.legacyCode, description.name, exception.message().isEmpty() ? description.message : exception.message()));
}

DOMException::DOMException(LegacyCode legacyCode, const String& name, const String& message)
    : m_legacyCode(legacyCode)
    , m_name(name)
    , m_message(message)
{
}

} // namespace WebCore
