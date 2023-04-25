/*
 * Copyright 2023 Codeblog Corp. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// ^ that comment is required or the builtins generator will have a fit.

function from(items) {
  "use strict";

  if (@isUndefinedOrNull(items)) {
    @throwTypeError(
      "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object.",
    );
  }
    

  // TODO: figure out why private symbol not found
  if (
    typeof items === "string" ||
    (typeof items === "object" &&
      (@isTypedArrayView(items) ||
        items instanceof ArrayBuffer ||
        items instanceof SharedArrayBuffer ||
        items instanceof @String))
  ) {
    switch (@argumentCount()) {
      case 1: {
        return new @Buffer(items);
      }
      case 2: {
        return new @Buffer(items, @argument(1));
      }
      default: {
        return new @Buffer(items, @argument(1), @argument(2));
      }
    }
  }

  var arrayLike = @toObject(
    items,
    "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.",
  );

  if (!@isJSArray(arrayLike)) {
    const toPrimitive = @tryGetByIdWithWellKnownSymbol(items, "toPrimitive");

    if (toPrimitive) {
      const primitive = toPrimitive.@call(items, "string");

      if (typeof primitive === "string") {
        switch (@argumentCount()) {
          case 1: {
            return new @Buffer(primitive);
          }
          case 2: {
            return new @Buffer(primitive, @argument(1));
          }
          default: {
            return new @Buffer(primitive, @argument(1), @argument(2));
          }
        }
      }
    }

    if (!("length" in arrayLike) || @isCallable(arrayLike)) {
      @throwTypeError(
        "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.",
      );
    }
  }

  // Don't pass the second argument because Node's Buffer.from doesn't accept
  // a function and Uint8Array.from requires it if it exists
  // That means we cannot use @tailCallFowrardArguments here, sadly
  return new @Buffer(@Uint8Array.from(arrayLike).buffer);
}
