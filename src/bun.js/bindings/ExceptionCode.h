/*
 *  Copyright (C) 2006-2020 Apple Inc. All rights reserved.
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#pragma once

#include "root.h"

#include <wtf/EnumTraits.h>

namespace WebCore {

enum ExceptionCode {
    // DOMException error names (https://webidl.spec.whatwg.org/#idl-DOMException-error-names).
    // Those need to be kept in sync with the array in DOMException.cpp.
    IndexSizeError, // Deprecated. Use RangeError instead.
    HierarchyRequestError,
    WrongDocumentError,
    InvalidCharacterError,
    NoModificationAllowedError,
    NotFoundError,
    NotSupportedError,
    InUseAttributeError,
    InvalidStateError,
    SyntaxError,
    InvalidModificationError,
    NamespaceError,
    InvalidAccessError, // Deprecated. use NotAllowedError instead.
    TypeMismatchError, // Deprecated. Use TypeError instead.
    SecurityError,
    NetworkError,
    AbortError,
    URLMismatchError,
    QuotaExceededError,
    TimeoutError,
    InvalidNodeTypeError,
    DataCloneError,
    EncodingError,
    NotReadableError,
    UnknownError,
    ConstraintError,
    DataError,
    TransactionInactiveError,
    ReadonlyError,
    VersionError,
    OperationError,
    NotAllowedError,

    // Simple exceptions (https://webidl.spec.whatwg.org/#idl-exceptions).
    RangeError,
    TypeError,
    JSSyntaxError, // Different from DOM SYNTAX_ERR.

    // Non-standard error.
    StackOverflowError,
    OutOfMemoryError,

    // Used to indicate to the bindings that a JS exception was thrown below and it should be propagated.
    ExistingExceptionError,

    InvalidThisError,
    InvalidURLError,
};

} // namespace WebCore

namespace WTF {

template<> struct EnumTraits<WebCore::ExceptionCode> {
    using values = EnumValues<
        WebCore::ExceptionCode,
        WebCore::ExceptionCode::IndexSizeError,
        WebCore::ExceptionCode::HierarchyRequestError,
        WebCore::ExceptionCode::WrongDocumentError,
        WebCore::ExceptionCode::InvalidCharacterError,
        WebCore::ExceptionCode::NoModificationAllowedError,
        WebCore::ExceptionCode::NotFoundError,
        WebCore::ExceptionCode::NotSupportedError,
        WebCore::ExceptionCode::InUseAttributeError,
        WebCore::ExceptionCode::InvalidStateError,
        WebCore::ExceptionCode::SyntaxError,
        WebCore::ExceptionCode::InvalidModificationError,
        WebCore::ExceptionCode::NamespaceError,
        WebCore::ExceptionCode::InvalidAccessError,
        WebCore::ExceptionCode::TypeMismatchError,
        WebCore::ExceptionCode::SecurityError,
        WebCore::ExceptionCode::NetworkError,
        WebCore::ExceptionCode::AbortError,
        WebCore::ExceptionCode::URLMismatchError,
        WebCore::ExceptionCode::QuotaExceededError,
        WebCore::ExceptionCode::TimeoutError,
        WebCore::ExceptionCode::InvalidNodeTypeError,
        WebCore::ExceptionCode::DataCloneError,
        WebCore::ExceptionCode::EncodingError,
        WebCore::ExceptionCode::NotReadableError,
        WebCore::ExceptionCode::UnknownError,
        WebCore::ExceptionCode::ConstraintError,
        WebCore::ExceptionCode::DataError,
        WebCore::ExceptionCode::TransactionInactiveError,
        WebCore::ExceptionCode::ReadonlyError,
        WebCore::ExceptionCode::VersionError,
        WebCore::ExceptionCode::OperationError,
        WebCore::ExceptionCode::NotAllowedError,
        WebCore::ExceptionCode::RangeError,
        WebCore::ExceptionCode::TypeError,
        WebCore::ExceptionCode::JSSyntaxError,
        WebCore::ExceptionCode::StackOverflowError,
        WebCore::ExceptionCode::ExistingExceptionError,
        WebCore::ExceptionCode::InvalidThisError,
        WebCore::ExceptionCode::InvalidURLError>;
};

} // namespace WTF
