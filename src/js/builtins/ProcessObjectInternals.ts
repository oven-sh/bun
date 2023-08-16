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

// TODO: move this to native code?
export function binding(bindingName) {
  if (bindingName === "constants") {
    return $processBindingConstants;
  }
  const issue = {
    fs: 3546,
    buffer: 2020,
    natives: 2254,
    uv: 2891,
  }[bindingName];
  if (issue) {
    throw new Error(
      `process.binding("${bindingName}") is not implemented in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/${issue}`,
    );
  }
  throw new TypeError(
    `process.binding("${bindingName}") is not implemented in Bun. If that breaks something, please file an issue and include a reproducible code sample.`,
  );
}

export function getStdioWriteStream(fd) {
  const tty = require("node:tty");

  const stream = tty.WriteStream(fd);

  process.on("SIGWINCH", () => {
    stream._refreshSize();
  });

  return stream;
}

export function getStdinStream(fd) {
  var { destroy } = require("node:stream");
  const tty = require("node:tty");

  const stream = new tty.ReadStream(fd);

  stream.fd = fd;

  stream.on("pause", () => {
    process.nextTick(() => {
      destroy(stream);
    });
  });

  return stream;
}
