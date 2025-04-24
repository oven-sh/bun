/*
 * Copyright (C) 2015 Canon Inc.
 * Copyright (C) 2015 Igalia
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
 * OF LIABILITY, WHETHER IN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// @internal

export function createFIFO() {
  // Implementation of FIFO queue, or import from internal/fifo if needed.
  // Placeholder: use a simple array-based queue for demonstration.
  const queue: any[] = [];
  return {
    push: (item: any) => queue.push(item),
    shift: () => queue.shift(),
    peek: () => queue[0],
    isEmpty: () => queue.length === 0,
    isNotEmpty: () => queue.length > 0,
    clear: () => { queue.length = 0; },
    get size() { return queue.length; },
    set size(val: number) { /* ignore, for compatibility */ },
    list: queue,
    content: { isEmpty: () => queue.length === 0 }
  };
}

export function extractHighWaterMark(strategy: any, defaultHWM: number) {
  let highWaterMark = strategy && strategy.highWaterMark;
  if (highWaterMark === undefined) {
    return defaultHWM;
  }
  highWaterMark = $toNumber(highWaterMark);
  if (highWaterMark !== highWaterMark || highWaterMark < 0) {
    $throwRangeError("Invalid highWaterMark value");
  }
  return highWaterMark;
}

export function extractSizeAlgorithm(strategy: any) {
  if (!strategy || strategy.size === undefined) {
    return () => 1;
  }
  const size = strategy.size;
  if (typeof size !== "function") {
    $throwTypeError("size must be a function");
  }
  return size;
}

export function markPromiseAsHandled(promise: any) {
  // In JSC, this is a no-op or marks the promise as handled to avoid unhandled rejection tracking.
  // Placeholder: do nothing.
}

export function promiseInvokeOrNoopMethod(target: any, method: Function, args: any[]) {
  try {
    const result = method.apply(target, args);
    if ($isPromise(result)) {
      return result;
    }
    return Promise.$resolve(result);
  } catch (e) {
    return Promise.$reject(e);
  }
}

export function promiseInvokeOrNoopMethodNoCatch(target: any, method: Function, args: any[]) {
  const result = method.apply(target, args);
  if ($isPromise(result)) {
    return result;
  }
  return Promise.$resolve(result);
}

export function resetQueue(queue: any) {
  if (queue && typeof queue.clear === "function") {
    queue.clear();
  } else if (queue && Array.isArray(queue.list)) {
    queue.list.length = 0;
    if ("size" in queue) queue.size = 0;
  }
}

export function enqueueValueWithSize(queue: any, value: any, size: number) {
  if (queue && typeof queue.push === "function") {
    queue.push(value);
    if ("size" in queue && typeof size === "number") {
      // Do not increment queue.size if it's a getter-only property (like in our createFIFO)
      // But for compatibility, if it's a real property, increment it.
      try {
        queue.size = (queue.size || 0) + size;
      } catch {}
    }
  }
}

export function peekQueueValue(queue: any) {
  if (queue && typeof queue.peek === "function") {
    return queue.peek();
  }
  if (queue && Array.isArray(queue.list)) {
    return queue.list[0];
  }
  return undefined;
}

export function dequeueValue(queue: any) {
  if (queue && typeof queue.shift === "function") {
    return queue.shift();
  }
  if (queue && Array.isArray(queue.list)) {
    return queue.list.shift();
  }
  return undefined;
}

export function createFulfilledPromise(value: any) {
  return Promise.$resolve(value);
}

export function newQueue() {
  return createFIFO();
}

export function extractHighWaterMarkFromQueuingStrategyInit(obj: any) {
  return extractHighWaterMark(obj, 1);
}

export function promiseInvokeOrNoop(target: any, methodName: string, args: any[]) {
  const method = target[methodName];
  if (typeof method === "function") {
    try {
      const result = method.apply(target, args);
      if ($isPromise(result)) {
        return result;
      }
      return Promise.$resolve(result);
    } catch (e) {
      return Promise.$reject(e);
    }
  }
  return Promise.$resolve();
}

export function promiseInvokeOrNoopNoCatch(target: any, methodName: string, args: any[]) {
  const method = target[methodName];
  if (typeof method === "function") {
    const result = method.apply(target, args);
    if ($isPromise(result)) {
      return result;
    }
    return Promise.$resolve(result);
  }
  return Promise.$resolve();
}

export function promiseInvokeOrFallbackOrNoop(target: any, methodName: string, fallback: Function, args: any[]) {
  const method = target[methodName];
  if (typeof method === "function") {
    try {
      const result = method.apply(target, args);
      if ($isPromise(result)) {
        return result;
      }
      return Promise.$resolve(result);
    } catch (e) {
      return Promise.$reject(e);
    }
  }
  try {
    const result = fallback.apply(target, args);
    if ($isPromise(result)) {
      return result;
    }
    return Promise.$resolve(result);
  } catch (e) {
    return Promise.$reject(e);
  }
}

export function toDictionary(obj: any) {
  if (obj == null) return {};
  if (typeof obj !== "object") $throwTypeError("Expected object for dictionary conversion");
  return obj;
}

export function validateAndNormalizeQueuingStrategy(size: any, highWaterMark: any) {
  return {
    size: extractSizeAlgorithm({ size }),
    highWaterMark: extractHighWaterMark({ highWaterMark }, 1),
  };
}

export function shieldingPromiseResolve(promise: any) {
  return Promise.$resolve(promise);
}