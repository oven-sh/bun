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

  if (fd === 1) {
    stream.destroySoon = stream.destroy;
    stream._destroy = function (err, cb) {
      cb(err);
      this._undestroy();

      if (!this._writableState.emitClose) {
        process.nextTick(() => {
          this.emit("close");
        });
      }
    };
  } else if (fd === 2) {
    stream.destroySoon = stream.destroy;
    stream._destroy = function (err, cb) {
      cb(err);
      this._undestroy();

      if (!this._writableState.emitClose) {
        process.nextTick(() => {
          this.emit("close");
        });
      }
    };
  }

  stream._type = "tty";
  stream._isStdio = true;
  stream.fd = fd;

  return stream;
}

export function getStdinStream(fd) {
  var { destroy } = require("node:stream");

  var reader: ReadableStreamDefaultReader | undefined;
  var readerRef;
  function ref() {
    reader ??= Bun.stdin.stream().getReader();
    // TODO: remove this. likely we are dereferencing the stream
    // when there is still more data to be read.
    readerRef ??= setInterval(() => {}, 1 << 30);
  }

  function unref() {
    if (readerRef) {
      clearInterval(readerRef);
      readerRef = undefined;
    }
  }

  const tty = require("node:tty");

  const stream = new tty.ReadStream(fd);

  stream.fd = fd;

  const originalPause = stream.pause;
  stream.pause = function () {
    unref();
    return originalPause.call(this);
  };

  const originalResume = stream.resume;
  stream.resume = function () {
    ref();
    return originalResume.call(this);
  };

  async function internalRead(stream) {
    try {
      var done: any, value: any;
      const read = reader?.readMany();

      if ($isPromise(read)) {
        ({ done, value } = await read);
      } else {
        // @ts-expect-error
        ({ done, value } = read);
      }

      if (!done) {
        stream.push(value[0]);

        // shouldn't actually happen, but just in case
        const length = value.length;
        for (let i = 1; i < length; i++) {
          stream.push(value[i]);
        }
      } else {
        stream.push(null);
        stream.pause();
      }
    } catch (err) {
      stream.destroy(err);
    }
  }

  stream._read = function (size) {
    internalRead(this);
  };

  stream.on("pause", () => {
    process.nextTick(() => {
      destroy(stream);
    });
  });

  stream.on("close", () => {
    process.nextTick(() => {
      reader?.cancel();
    });
  });

  return stream;
}
