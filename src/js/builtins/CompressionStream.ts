/*
 * Copyright (C) 2025 Anthropic PBC. All rights reserved.
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
  // Validate format
  if (format !== "deflate" && format !== "deflate-raw" && format !== "gzip") {
    throw new TypeError(`The provided value '${format}' is not a valid enum value of type CompressionFormat.`);
  }

  const zlib = require("node:zlib");
  let compressor;

  // Create the appropriate compressor based on the format
  if (format === "deflate") {
    compressor = zlib.createDeflate();
  } else if (format === "deflate-raw") {
    compressor = zlib.createDeflateRaw();
  } else if (format === "gzip") {
    compressor = zlib.createGzip();
  }

  const startAlgorithm = () => {
    return Promise.$resolve();
  };

  const transformAlgorithm = chunk => {
    const comp = $getByIdDirectPrivate(this, "compressionStreamCompressor");
    return new Promise((resolve, reject) => {
      comp.write(chunk, err => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  const flushAlgorithm = () => {
    const comp = $getByIdDirectPrivate(this, "compressionStreamCompressor");
    return new Promise((resolve, reject) => {
      comp.once("end", () => resolve());
      comp.once("error", err => reject(err));
      comp.end();
    });
  };

  const transform = $createTransformStream(startAlgorithm, transformAlgorithm, flushAlgorithm);
  $putByIdDirectPrivate(this, "compressionStreamTransform", transform);
  $putByIdDirectPrivate(this, "compressionStreamCompressor", compressor);

  // Set up persistent data handler to feed compressed data to the transform stream
  compressor.on("data", chunk => {
    const transformStream = $getByIdDirectPrivate(this, "compressionStreamTransform");
    const controller = $getByIdDirectPrivate(transformStream, "controller");
    $transformStreamDefaultControllerEnqueue(controller, chunk);
  });

  compressor.on("error", err => {
    const transformStream = $getByIdDirectPrivate(this, "compressionStreamTransform");
    const controller = $getByIdDirectPrivate(transformStream, "controller");
    $transformStreamDefaultControllerError(controller, err);
  });

  return this;
}

$getter;
export function readable() {
  const transform = $getByIdDirectPrivate(this, "compressionStreamTransform");
  if (!transform) throw $ERR_INVALID_THIS("CompressionStream");

  return $getByIdDirectPrivate(transform, "readable");
}

$getter;
export function writable() {
  const transform = $getByIdDirectPrivate(this, "compressionStreamTransform");
  if (!transform) throw $ERR_INVALID_THIS("CompressionStream");

  return $getByIdDirectPrivate(transform, "writable");
}
