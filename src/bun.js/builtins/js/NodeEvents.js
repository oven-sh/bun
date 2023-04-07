/*
 * Copyright 2022 Codeblog Corp. All rights reserved.
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

function onAsyncIterator(emitter, event, options) {
  "use strict";

  var { AbortSignal, Symbol, Number, Error } = globalThis;

  function makeAbortError(msg, opts = void 0) {
    var AbortError = class AbortError extends Error {
      constructor(message = "The operation was aborted", options = void 0) {
        if (options !== void 0 && typeof options !== "object") {
          throw new Error(`Invalid AbortError options:\n\n${JSON.stringify(options, null, 2)}`);
        }
        super(message, options);
        this.code = "ABORT_ERR";
        this.name = "AbortError";
      }
    };
    return new AbortError(msg, opts);
  }

  if (@isUndefinedOrNull(emitter)) @throwTypeError("emitter is required");
  // TODO: Do a more accurate check
  if (!(@isObject(emitter) && @isCallable(emitter.emit) && @isCallable(emitter.on)))
    @throwTypeError("emitter must be an EventEmitter");

  if (@isUndefinedOrNull(options)) options = {};

  // Parameters validation
  var signal = options.signal;
  if (signal !== undefined && (!@isObject(signal) || !(signal instanceof AbortSignal)))
    @throwTypeError("options.signal must be an AbortSignal");

  if (signal?.aborted) {
    // TODO: Make this a builtin
    throw makeAbortError(@undefined, { cause: signal?.reason });
  }

  var highWatermark = options.highWatermark ?? Number.MAX_SAFE_INTEGER;
  if (highWatermark < 1) 
    @throwRangeError("options.highWatermark must be >= 1");

  var lowWatermark = options.lowWatermark ?? 1;
  if (lowWatermark < 1) 
    @throwRangeError("options.lowWatermark must be >= 1");

  var unconsumedEvents = @createFIFO();
  var unconsumedPromises = @createFIFO();

  var paused = false;
  var error = null;
  var finished = false;
  var size = 0;
  var listeners = [];

  function abortListener() {
    errorHandler(makeAbortError(@undefined, { cause: signal?.reason }));
  }

  function eventHandler(value) {
    if (unconsumedPromises.isEmpty()) {
      size++;
      if (!paused && size > highWatermark) {
        paused = true;
        emitter.pause();
      }
      unconsumedEvents.push(value);
    } else unconsumedPromises.shift().@resolve.@call(@undefined, [value]);
  }

  function closeHandler() {
    removeAllListeners();
    finished = true;
    while (!unconsumedPromises.isEmpty()) {
      const promise = unconsumedPromises.shift();
      promise.@resolve.@call(@undefined, [@undefined]);
    }
    return @createFulfilledPromise([@undefined]);
  }

  function errorHandler(err) {
    if (unconsumedPromises.isEmpty()) error = err;
    else unconsumedPromises.shift().@reject.@call(@undefined, err);
  
    closeHandler();
  }
  
  function addEventListener(emitter, event, handler) {
    emitter.on(event, handler);
    listeners.push([emitter, event, handler]);
  }
  
  function removeAllListeners() {
    while (listeners.length > 0) {
      var entry = listeners.pop();
      var [emitter, event, handler] = entry;
      emitter.off(event, handler);
    }
  }

  var createIterator = async function* NodeEventsOnAsyncIterator() {
    // First, we consume all unread events
    try {
      while (true) {
        // Go through queued events
        while (size) {
          const value = unconsumedEvents.shift();
          size--;
          if (paused && size < lowWatermark) {
            emitter.resume();
            paused = false;
            break;
          }
          yield @createFulfilledPromise([value]);
        }

        // Check if error happened before yielding anything
        // This happens one time if at all, because after 'error'
        // we stop listening
        if (error) {
          throw error;
        }

        // If the iterator is finished, break
        if (finished) break;

        // Wait until an event happens
        var nextEventPromiseCapability = @newPromiseCapability(@Promise);
        unconsumedPromises.push(nextEventPromiseCapability);
        yield nextEventPromiseCapability.@promise;
      }
    } finally {
      closeHandler();
    }
  };

  // Adding event handlers
  addEventListener(emitter, event, eventHandler);
  if (event !== "error" && typeof emitter.on === "function") {
    addEventListener(emitter, "error", errorHandler);
  }
  var closeEvents = options?.close;
  if (closeEvents?.length) {
    for (var i = 0; i < closeEvents.length; i++) {
      addEventListener(emitter, closeEvents[i], closeHandler);
    }
  }

  if (signal) signal.addEventListener("abort", abortListener, { once: true });

  var iterator = createIterator();
  @Object.defineProperties(iterator, {
    return: {
      value: () => closeHandler(),
    },
    throw: {
      value: (err) => {
        if (!err || !(err instanceof Error)) {
          throw new TypeError("EventEmitter.AsyncIterator must be called with an error");
        }
        errorHandler(err);
      },
    },
    [Symbol.asyncIterator]: {
      value: () => iterator,
    },
  });
  return iterator;
}

function oncePromise(emitter, name, options) {
  "use strict";

  var { AbortSignal, Error } = globalThis;

  function makeAbortError(msg, opts = void 0) {
    var AbortError = class AbortError extends Error {
      constructor(message = "The operation was aborted", options = void 0) {
        if (options !== void 0 && typeof options !== "object") {
          throw new Error(`Invalid AbortError options:\n\n${JSON.stringify(options, null, 2)}`);
        }
        super(message, options);
        this.code = "ABORT_ERR";
        this.name = "AbortError";
      }
    };
    return new AbortError(msg, opts);
  }

  if (@isUndefinedOrNull(emitter)) return @Promise.@reject(@makeTypeError("emitter is required"));
  // TODO: Do a more accurate check
  if (!(@isObject(emitter) && @isCallable(emitter.emit) && @isCallable(emitter.on)))
    return @Promise.@reject(@makeTypeError("emitter must be an EventEmitter"));

  if (@isUndefinedOrNull(options)) options = {};

  // Parameters validation
  var signal = options.signal;
  if (signal !== @undefined && (!@isObject(signal) || !(signal instanceof AbortSignal)))
    return @Promise.@reject(@makeTypeError("options.signal must be an AbortSignal"));

  if (signal?.aborted) {
    // TODO: Make this a builtin
    return @Promise.@reject(makeAbortError(@undefined, { cause: signal?.reason }));
  }

  var eventPromiseCapability = @newPromiseCapability(@Promise);

  var errorListener = (err) => {
    emitter.removeListener(name, resolver);
    if (!@isUndefinedOrNull(signal)) {
      signal.removeEventListener("abort", abortListener);
    }
    eventPromiseCapability.@reject.@call(@undefined, err);
  };

  var resolver = (...args) => {
    if (@isCallable(emitter.removeListener)) {
      emitter.removeListener("error", errorListener);
    }
    if (!@isUndefinedOrNull(signal)) {
      signal.removeEventListener("abort", abortListener);
    }
    eventPromiseCapability.@resolve.@call(@undefined, args);
  };
  
  emitter.once(name, resolver);
  if (name !== "error" && @isCallable(emitter.once)) {
    // EventTarget does not have `error` event semantics like Node
    // EventEmitters, we listen to `error` events only on EventEmitters.
    emitter.once("error", errorListener);
  }

  function abortListener() {
    emitter.removeListener(name, resolver);
    emitter.removeListener("error", errorListener);
    eventPromiseCapability.@reject.@call(@undefined, makeAbortError(@undefined, { cause: signal?.reason }));
  }

  if (!@isUndefinedOrNull(signal))
    signal.addEventListener("abort", abortListener, { once: true });

  return eventPromiseCapability.@promise;
}
