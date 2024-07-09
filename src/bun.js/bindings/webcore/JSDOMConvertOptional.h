// /*
//  * Copyright (C) 2024 Apple Inc. All rights reserved.
//  *
//  * Redistribution and use in source and binary forms, with or without
//  * modification, are permitted provided that the following conditions
//  * are met:
//  * 1. Redistributions of source code must retain the above copyright
//  *    notice, this list of conditions and the following disclaimer.
//  * 2. Redistributions in binary form must reproduce the above copyright
//  *    notice, this list of conditions and the following disclaimer in the
//  *    documentation and/or other materials provided with the distribution.
//  *
//  * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
//  * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
//  * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
//  * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
//  * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
//  * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
//  * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
//  * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
//  * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
//  * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
//  * THE POSSIBILITY OF SUCH DAMAGE.
//  */

// #pragma once

// #include "JSDOMConvertDictionary.h"
// #include "JSDOMConvertNullable.h"

// namespace WebCore {

// namespace Detail {

// template<typename IDL>
// struct OptionalConversionType;

// template<typename IDL>
// struct OptionalConversionType {
//     using Type = typename IDLOptional<IDL>::ConversionResultType;
// };

// template<>
// struct OptionalConversionType<IDLObject> {
//     using Type = std::optional<JSC::Strong<JSC::JSObject>>;
// };

// template<typename T>
// struct OptionalConversionType<IDLDictionary<T>> {
//     using Type = std::conditional_t<std::is_default_constructible_v<T>, T, std::optional<T>>;
// };

// }

// // `IDLOptional` is just like `IDLNullable`, but used in places that where the type is implicitly optional,
// // like optional arguments to functions without default values, or non-required members of dictionaries
// // without default values.
// //
// // As such, rather than checking `isUndefinedOrNull()`, IDLOptional uses `isUndefined()` matching what
// // is needed in those cases.

// template<typename IDL> struct Converter<IDLOptional<IDL>> : DefaultConverter<IDLOptional<IDL>> {
//     using ReturnType = typename Detail::OptionalConversionType<IDL>::Type;
//     using Result = ConversionResult<IDLOptional<IDL>>;

//     static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
//     {
//         if (value.isUndefined())
//             return ReturnType {};
//         return WebCore::convert<IDL>(lexicalGlobalObject, value);
//     }
//     static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject)
//     {
//         if (value.isUndefined())
//             return ReturnType {};
//         return WebCore::convert<IDL>(lexicalGlobalObject, value, thisObject);
//     }
//     static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject)
//     {
//         if (value.isUndefined())
//             return ReturnType {};
//         return WebCore::convert<IDL>(lexicalGlobalObject, value, globalObject);
//     }
//     template<ExceptionThrowerFunctor ExceptionThrower = DefaultExceptionThrower>
//     static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower)
//     {
//         if (value.isUndefined())
//             return ReturnType {};
//         return WebCore::convert<IDL>(lexicalGlobalObject, value, std::forward<ExceptionThrower>(exceptionThrower));
//     }
//     template<ExceptionThrowerFunctor ExceptionThrower = DefaultExceptionThrower>
//     static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject, ExceptionThrower&& exceptionThrower)
//     {
//         if (value.isUndefined())
//             return ReturnType {};
//         return WebCore::convert<IDL>(lexicalGlobalObject, value, thisObject, std::forward<ExceptionThrower>(exceptionThrower));
//     }
//     template<ExceptionThrowerFunctor ExceptionThrower = DefaultExceptionThrower>
//     static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, ExceptionThrower&& exceptionThrower)
//     {
//         if (value.isUndefined())
//             return ReturnType {};
//         return WebCore::convert<IDL>(lexicalGlobalObject, value, globalObject, std::forward<ExceptionThrower>(exceptionThrower));
//     }
// };

// // MARK: Helper functions for invoking an optional conversion.

// template<typename IDL, DefaultValueFunctor<IDL> DefaultValueFunctor>
// ConversionResult<IDL> convertOptionalWithDefault(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, DefaultValueFunctor&& defaultValue)
// {
//     if (value.isUndefined())
//         return defaultValue();
//     return convert<IDL>(lexicalGlobalObject, value);
// }

// template<typename IDL, DefaultValueFunctor<IDL> DefaultValueFunctor>
// ConversionResult<IDL> convertOptionalWithDefault(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject, DefaultValueFunctor&& defaultValue)
// {
//     if (value.isUndefined())
//         return defaultValue();
//     return convert<IDL>(lexicalGlobalObject, value, thisObject);
// }

// template<typename IDL, DefaultValueFunctor<IDL> DefaultValueFunctor>
// ConversionResult<IDL> convertOptionalWithDefault(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, DefaultValueFunctor&& defaultValue)
// {
//     if (value.isUndefined())
//         return defaultValue();
//     return convert<IDL>(lexicalGlobalObject, value, globalObject);
// }

// template<typename IDL, DefaultValueFunctor<IDL> DefaultValueFunctor, ExceptionThrowerFunctor ExceptionThrower>
// ConversionResult<IDL> convertOptionalWithDefault(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, DefaultValueFunctor&& defaultValue, ExceptionThrower&& exceptionThrower)
// {
//     if (value.isUndefined())
//         return defaultValue();
//     return convert<IDL>(lexicalGlobalObject, value, std::forward<ExceptionThrower>(exceptionThrower));
// }

// template<typename IDL, DefaultValueFunctor<IDL> DefaultValueFunctor, ExceptionThrowerFunctor ExceptionThrower>
// ConversionResult<IDL> convertOptionalWithDefault(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject, DefaultValueFunctor&& defaultValue, ExceptionThrower&& exceptionThrower)
// {
//     if (value.isUndefined())
//         return defaultValue();
//     return convert<IDL>(lexicalGlobalObject, value, thisObject, std::forward<ExceptionThrower>(exceptionThrower));
// }

// template<typename IDL, DefaultValueFunctor<IDL> DefaultValueFunctor, ExceptionThrowerFunctor ExceptionThrower>
// ConversionResult<IDL> convertOptionalWithDefault(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, DefaultValueFunctor&& defaultValue, ExceptionThrower&& exceptionThrower)
// {
//     if (value.isUndefined())
//         return defaultValue();
//     return convert<IDL>(lexicalGlobalObject, value, globalObject, std::forward<ExceptionThrower>(exceptionThrower));
// }

// } // namespace WebCore
