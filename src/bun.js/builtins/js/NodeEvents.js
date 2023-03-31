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

  // var AbortError = class AbortError extends Error {
  //   constructor(message = "The operation was aborted", options = void 0) {
  //     if (options !== void 0 && typeof options !== "object") {
  //       throw new Error(`Invalid AbortError options:\n\n${JSON.stringify(options, null, 2)}`);
  //     }
  //     super(message, options);
  //     this.code = "ABORT_ERR";
  //     this.name = "AbortError";
  //   }
  // };

  // var { AbortSignal, Object, Number, console } = globalThis;
  var { Object, Number, console, Symbol } = globalThis;
  // console.log("AbortSignal", AbortSignal);

  function isUndefinedOrNull(value) {
    return value === undefined || value === null;
  }

  if (isUndefinedOrNull(options)) options = {};

  // Parameters validation
  var signal = options.signal;
  // if (!isUndefinedOrNull(signal) && !(signal instanceof AbortSignal))
  //   @throwTypeError("options.signal must be an AbortSignal");

  // if (signal?.aborted) {
  //   // TODO: Make this a builtin
  //   throw new AbortError(undefined, { cause: signal?.reason });
  // }

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

  // function abortListener() {
  //   errorHandler(new AbortError(undefined, { cause: signal?.reason }));
  // }

  function eventHandler(value) {
    if (unconsumedPromises.isEmpty()) {
      size++;
      if (!paused && size > highWatermark) {
        paused = true;
        emitter.pause();
      }
      unconsumedEvents.push(value);
    } else unconsumedPromises.shift().@resolve.@call(undefined, [value]);
  }

  function closeHandler() {
    removeAllListeners(listeners);
    finished = true;
    while (!unconsumedPromises.isEmpty()) {
      unconsumedPromises.shift().@resolve.@call(undefined, [undefined]);
    }
  
    return @createFulfilledPromise([undefined]);
  }

  function errorHandler(err) {
    if (unconsumedPromises.isEmpty()) error = err;
    else unconsumedPromises.shift().@reject.@call(undefined, err);
  
    closeHandler();
  }
  
  function addEventListener(emitter, event, handler) {
    emitter.on(event, handler);
    listeners.push([emitter, event, handler]);
    // @arrayPush(listeners, [emitter, event, handler]);
  }
  
  function removeAllListeners() {
    var heldEmitter;
    while (listeners.length > 0) {
      // var [emitter, event, handler] = @arrayPop(listeners);
      var entry = listeners.pop();
      var [emitter, event, handler] = entry;
      if (event === "foo") heldEmitter = emitter;
      console.log(emitter, event, handler);
      emitter.off(event, handler);
    }
    console.log(heldEmitter.listenerCount("foo"));
  }

  var iterator = async function* NodeEventsOnAsyncIterator() {
      // First, we consume all unread events
      while (!finished) {
        if (size) {
          var values = [];
          while (size) {
            values.push(unconsumedEvents.shift());
            size--;
            if (paused && size < lowWatermark) {
              emitter.resume();
              paused = false;
              break;
            }
          }
          yield @createFulfilledPromise(values);
        }

        // Then we error, if an error happened
        // This happens one time if at all, because after 'error'
        // we stop listening
        if (error) {
          throw error;
        }

        // If the iterator is finished, break
        if (finished) {
          console.log("FINISHED")
          yield closeHandler();
          break;
        };

        // Wait until an event happens
        var nextEventPromiseCapability = @newPromiseCapability(@Promise);
        unconsumedPromises.push(nextEventPromiseCapability);
        yield nextEventPromiseCapability.@promise;
      }
  };

  // // TODO: Use builtin
  // Object.defineProperties(iterator, {
  //   "throw": {
  //     value: (err) => {
  //       // TODO: Use Error builtin?
  //       if (err === undefined || err === null || !(err instanceof Error)) {
  //         @throwTypeError("The argument must be an instance of Error");
  //       }
  //       errorHandler(err);
  //     },
  //   },
  //   "return": {
  //     value: () => {
  //       return closeHandler();
  //     }
  //   },
  //   [Symbol.asyncIterator]: {
  //     value: () => iterator,
  //   },
  //   // [kWatermarkData]: {
  //   //   /**
  //   //    * The current queue size
  //   //    */
  //   //   get size() {
  //   //     return size;
  //   //   },
  //   //   /**
  //   //    * The low watermark. The emitter is resumed every time size is lower than it
  //   //    */
  //   //   get low() {
  //   //     return lowWatermark;
  //   //   },
  //   //   /**
  //   //    * The high watermark. The emitter is paused every time size is higher than it
  //   //    */
  //   //   get high() {
  //   //     return highWatermark;
  //   //   },
  //   //   /**
  //   //    * It checks whether the emitter is paused by the watermark controller or not
  //   //    */
  //   //   get isPaused() {
  //   //     return paused;
  //   //   },
  //   // },
  // });

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

  // if (signal)
  //   signal.once("abort", abortListener);

  return {
    throw: (err) => {
      if (err === undefined || err === null || !(err instanceof Error)) {
        @throwTypeError("The argument must be an instance of Error");
      }
      errorHandler(err);
    },
    return: () => {
      console.log("we're here");
      return closeHandler();
    },
    next: () => iterator.next(),
    [Symbol.asyncIterator]: iterator,
  };
}
