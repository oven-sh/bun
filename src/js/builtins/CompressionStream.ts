/*
 * Copyright (C) 2022 Apple Inc. All rights reserved.
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
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
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

export function initializeCompressionStream(format) {
  "use strict";

  const errorMessage =
    "CompressionStream requires a single argument with the value 'brotli', 'deflate', 'deflate-raw', 'gzip', or 'zstd'.";

  if (arguments.length < 1) $throwTypeError(errorMessage);

  const algorithms = ["brotli", "gzip", "deflate", "deflate-raw", "zstd"];
  const lowercaseFormat = $toString(arguments[0]).toLowerCase();
  const findAlgorithm = element => element === lowercaseFormat;

  // Pass the index to our new CompressionStreamEncoder, so we do not need to reparse the string.
  // We need to ensure that the Formats.h and this file stay in sync.
  const index = algorithms.findIndex(findAlgorithm);

  if (index === -1) $throwTypeError(errorMessage);

  // Setup Transform and Flush Algorithms
  const startAlgorithm = () => {
    return Promise.$resolve();
  };
  const transformAlgorithm = chunk => {
    // No longer need to check for ArrayBuffer since the encoder handles strings now
    try {
      const encoder = $getByIdDirectPrivate(this, "compressionStreamEncoder");

      let buffer = encoder.encode(chunk);
      if (buffer) {
        const transformStream = $getByIdDirectPrivate(this, "compressionStreamTransform");
        const controller = $getByIdDirectPrivate(transformStream, "controller");
        $transformStreamDefaultControllerEnqueue(controller, buffer);
      }
    } catch (e) {
      return Promise.$reject($makeTypeError(e.message));
    }

    return Promise.$resolve();
  };
  const flushAlgorithm = () => {
    const encoder = $getByIdDirectPrivate(this, "compressionStreamEncoder");

    let buffer;
    try {
      buffer = encoder.flush();
    } catch (e) {
      return Promise.$reject($makeTypeError(e.message));
    }
    if (buffer) {
      const transformStream = $getByIdDirectPrivate(this, "compressionStreamTransform");
      const controller = $getByIdDirectPrivate(transformStream, "controller");
      $transformStreamDefaultControllerEnqueue(controller, buffer);
    }

    return Promise.$resolve();
  };

  // Create encoder BEFORE creating transform stream
  const encoder = new $CompressionStreamEncoder(index);
  $putByIdDirectPrivate(this, "compressionStreamEncoder", encoder);

  const transform = $createTransformStream(
    startAlgorithm,
    transformAlgorithm,
    flushAlgorithm,
    1,
    undefined,
    16,
    undefined,
  );
  $putByIdDirectPrivate(this, "compressionStreamTransform", transform);
  return this;
}

$getter;
export function readable() {
  "use strict";

  const transform = $getByIdDirectPrivate(this, "compressionStreamTransform");
  if (!transform) throw $ERR_INVALID_THIS("CompressionStream");

  return $getByIdDirectPrivate(transform, "readable");
}

$getter;
export function writable() {
  "use strict";

  const transform = $getByIdDirectPrivate(this, "compressionStreamTransform");
  if (!transform) throw $ERR_INVALID_THIS("CompressionStream");

  return $getByIdDirectPrivate(transform, "writable");
}
