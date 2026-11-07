/*
    This file follows the structure of the generate-bindings.pl outputs in this
    directory; see JSAeadParams.cpp.

    This library is free software; you can redistribute it and/or
    modify it under the terms of the GNU Library General Public
    License as published by the Free Software Foundation; either
    version 2 of the License, or (at your option) any later version.

    This library is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
    Library General Public License for more details.

    You should have received a copy of the GNU Library General Public License
    along with this library; see the file COPYING.LIB.  If not, write to
    the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
    Boston, MA 02110-1301, USA.
*/

#include "config.h"

#if ENABLE(WEB_CRYPTO)

#include "JSMlDsaParams.h"

#include "JSDOMConvertBufferSource.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMConvertUnion.h"
#include <JavaScriptCore/JSCInlines.h>
#include <variant>

namespace WebCore {
using namespace JSC;

template<> CryptoAlgorithmMlDsaParams convertDictionary<CryptoAlgorithmMlDsaParams>(JSGlobalObject& lexicalGlobalObject, JSValue value)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    bool isNullOrUndefined = value.isUndefinedOrNull();
    auto* object = isNullOrUndefined ? nullptr : value.getObject();
    if (!isNullOrUndefined && !object) [[unlikely]] {
        throwTypeError(&lexicalGlobalObject, throwScope);
        return {};
    }
    CryptoAlgorithmMlDsaParams result;
    JSValue nameValue;
    if (isNullOrUndefined)
        nameValue = jsUndefined();
    else {
        nameValue = object->get(&lexicalGlobalObject, vm.propertyNames->name);
        RETURN_IF_EXCEPTION(throwScope, {});
    }
    if (!nameValue.isUndefined()) {
        result.name = convert<IDLDOMString>(lexicalGlobalObject, nameValue);
        RETURN_IF_EXCEPTION(throwScope, {});
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "name"_s, "ContextParams"_s, "DOMString"_s);
        return {};
    }
    JSValue contextValue;
    if (isNullOrUndefined)
        contextValue = jsUndefined();
    else {
        contextValue = object->get(&lexicalGlobalObject, Identifier::fromString(vm, "context"_s));
        RETURN_IF_EXCEPTION(throwScope, {});
    }
    if (!contextValue.isUndefined()) {
        result.context = convert<IDLUnion<IDLArrayBufferView, IDLArrayBuffer>>(lexicalGlobalObject, contextValue);
        RETURN_IF_EXCEPTION(throwScope, {});
    }
    return result;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
