// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = process.nextTick(callback, second, 2.5);
    console.log("process.nextTick, is it an operand:", result === callback, result === second);
    console.log("process.nextTick:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.nextTick: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = process.nextTick(callback, 2.5, 2.5);
    console.log("process.nextTick, form 2, is it an operand:", result === callback);
    console.log("process.nextTick, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.nextTick, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const third = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = process.nextTick(callback, item, third);
    console.log("process.nextTick, form 3, is it an operand:", result === callback, result === item, result === third);
    console.log("process.nextTick, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.nextTick, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    class Item {
      constructor(size) {
        this.size = size;
      }
      double() {
        return this.size * 2;
      }
    }
    const item = new Item(1.5);
    const second = { first: 1.5, second: "two", third: item };
    function callback() {
      return true;
    }
    const result = process.nextTick(callback, second, 2.5);
    console.log("process.nextTick, form 4, is it an operand:", result === callback, result === second);
    console.log("process.nextTick, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.nextTick, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    function callback() {
      return true;
    }
    const result = process.nextTick(callback);
    console.log("process.nextTick, form 5, is it an operand:", result === callback);
    console.log("process.nextTick, form 5:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.nextTick, form 5: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.noDeprecation;
    console.log("process.noDeprecation, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.noDeprecation, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.noProcessWarnings;
    console.log("process.noProcessWarnings, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.noProcessWarnings, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.openStdin();
    console.log("process.openStdin:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("process.openStdin, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("process.openStdin, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("process.openStdin, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("process.openStdin, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("process.openStdin, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("process.openStdin, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("process.openStdin.fd:", typeof result.fd === "undefined", typeof result.fd === "boolean", typeof result.fd === "number", typeof result.fd === "string", typeof result.fd === "bigint", typeof result.fd === "symbol", typeof result.fd === "function", typeof result.fd === "object", result.fd === null);
    console.log("process.openStdin.start:", typeof result.start === "undefined", typeof result.start === "boolean", typeof result.start === "number", typeof result.start === "string", typeof result.start === "bigint", typeof result.start === "symbol", typeof result.start === "function", typeof result.start === "object", result.start === null);
    console.log("process.openStdin.end:", typeof result.end === "undefined", typeof result.end === "boolean", typeof result.end === "number", typeof result.end === "string", typeof result.end === "bigint", typeof result.end === "symbol", typeof result.end === "function", typeof result.end === "object", result.end === null);
    console.log("process.openStdin.pos:", typeof result.pos === "undefined", typeof result.pos === "boolean", typeof result.pos === "number", typeof result.pos === "string", typeof result.pos === "bigint", typeof result.pos === "symbol", typeof result.pos === "function", typeof result.pos === "object", result.pos === null);
  } catch (error) {
    console.log("process.openStdin: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.openStdin();
    console.log("process.openStdin, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("process.openStdin, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("process.openStdin, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("process.openStdin, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("process.openStdin, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("process.openStdin, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("process.openStdin, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("process.openStdin, form 2.fd:", typeof result.fd === "undefined", typeof result.fd === "boolean", typeof result.fd === "number", typeof result.fd === "string", typeof result.fd === "bigint", typeof result.fd === "symbol", typeof result.fd === "function", typeof result.fd === "object", result.fd === null);
    console.log("process.openStdin, form 2.start:", typeof result.start === "undefined", typeof result.start === "boolean", typeof result.start === "number", typeof result.start === "string", typeof result.start === "bigint", typeof result.start === "symbol", typeof result.start === "function", typeof result.start === "object", result.start === null);
    console.log("process.openStdin, form 2.end:", typeof result.end === "undefined", typeof result.end === "boolean", typeof result.end === "number", typeof result.end === "string", typeof result.end === "bigint", typeof result.end === "symbol", typeof result.end === "function", typeof result.end === "object", result.end === null);
    console.log("process.openStdin, form 2.pos:", typeof result.pos === "undefined", typeof result.pos === "boolean", typeof result.pos === "number", typeof result.pos === "string", typeof result.pos === "bigint", typeof result.pos === "symbol", typeof result.pos === "function", typeof result.pos === "object", result.pos === null);
  } catch (error) {
    console.log("process.openStdin, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.pendingDeprecation;
    console.log("process.pendingDeprecation, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.pendingDeprecation, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.pid;
    console.log("process.pid, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.pid, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.platform;
    console.log("process.platform, get, is it a text that its row names:", result === "android" || result === "darwin" || result === "freebsd" || result === "linux" || result === "win32");
    console.log("process.platform, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.platform, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.resourceUsage();
    const again = process.resourceUsage();
    console.log("process.resourceUsage, does a second call answer the same thing:", result === again);
    console.log("process.resourceUsage:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("process.resourceUsage, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("process.resourceUsage, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("process.resourceUsage, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("process.resourceUsage, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("process.resourceUsage, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("process.resourceUsage, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("process.resourceUsage, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("process.resourceUsage.userCPUTime:", typeof result.userCPUTime === "undefined", typeof result.userCPUTime === "boolean", typeof result.userCPUTime === "number", typeof result.userCPUTime === "string", typeof result.userCPUTime === "bigint", typeof result.userCPUTime === "symbol", typeof result.userCPUTime === "function", typeof result.userCPUTime === "object", result.userCPUTime === null);
    console.log("process.resourceUsage.systemCPUTime:", typeof result.systemCPUTime === "undefined", typeof result.systemCPUTime === "boolean", typeof result.systemCPUTime === "number", typeof result.systemCPUTime === "string", typeof result.systemCPUTime === "bigint", typeof result.systemCPUTime === "symbol", typeof result.systemCPUTime === "function", typeof result.systemCPUTime === "object", result.systemCPUTime === null);
    console.log("process.resourceUsage.maxRSS:", typeof result.maxRSS === "undefined", typeof result.maxRSS === "boolean", typeof result.maxRSS === "number", typeof result.maxRSS === "string", typeof result.maxRSS === "bigint", typeof result.maxRSS === "symbol", typeof result.maxRSS === "function", typeof result.maxRSS === "object", result.maxRSS === null);
    console.log("process.resourceUsage.sharedMemorySize:", typeof result.sharedMemorySize === "undefined", typeof result.sharedMemorySize === "boolean", typeof result.sharedMemorySize === "number", typeof result.sharedMemorySize === "string", typeof result.sharedMemorySize === "bigint", typeof result.sharedMemorySize === "symbol", typeof result.sharedMemorySize === "function", typeof result.sharedMemorySize === "object", result.sharedMemorySize === null);
  } catch (error) {
    console.log("process.resourceUsage: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.resourceUsage();
    const again = process.resourceUsage();
    console.log("process.resourceUsage, form 2, does a second call answer the same thing:", result === again);
    console.log("process.resourceUsage, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("process.resourceUsage, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("process.resourceUsage, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("process.resourceUsage, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("process.resourceUsage, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("process.resourceUsage, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("process.resourceUsage, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("process.resourceUsage, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("process.resourceUsage, form 2.userCPUTime:", typeof result.userCPUTime === "undefined", typeof result.userCPUTime === "boolean", typeof result.userCPUTime === "number", typeof result.userCPUTime === "string", typeof result.userCPUTime === "bigint", typeof result.userCPUTime === "symbol", typeof result.userCPUTime === "function", typeof result.userCPUTime === "object", result.userCPUTime === null);
    console.log("process.resourceUsage, form 2.systemCPUTime:", typeof result.systemCPUTime === "undefined", typeof result.systemCPUTime === "boolean", typeof result.systemCPUTime === "number", typeof result.systemCPUTime === "string", typeof result.systemCPUTime === "bigint", typeof result.systemCPUTime === "symbol", typeof result.systemCPUTime === "function", typeof result.systemCPUTime === "object", result.systemCPUTime === null);
    console.log("process.resourceUsage, form 2.maxRSS:", typeof result.maxRSS === "undefined", typeof result.maxRSS === "boolean", typeof result.maxRSS === "number", typeof result.maxRSS === "string", typeof result.maxRSS === "bigint", typeof result.maxRSS === "symbol", typeof result.maxRSS === "function", typeof result.maxRSS === "object", result.maxRSS === null);
    console.log("process.resourceUsage, form 2.sharedMemorySize:", typeof result.sharedMemorySize === "undefined", typeof result.sharedMemorySize === "boolean", typeof result.sharedMemorySize === "number", typeof result.sharedMemorySize === "string", typeof result.sharedMemorySize === "bigint", typeof result.sharedMemorySize === "symbol", typeof result.sharedMemorySize === "function", typeof result.sharedMemorySize === "object", result.sharedMemorySize === null);
  } catch (error) {
    console.log("process.resourceUsage, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.revision;
    console.log("process.revision, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.revision, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.threadCpuUsage();
    const again = process.threadCpuUsage();
    console.log("process.threadCpuUsage, does a second call answer the same thing:", result === again);
    console.log("process.threadCpuUsage:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("process.threadCpuUsage, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("process.threadCpuUsage, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("process.threadCpuUsage, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("process.threadCpuUsage, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("process.threadCpuUsage, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("process.threadCpuUsage, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("process.threadCpuUsage, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("process.threadCpuUsage.user:", typeof result.user === "undefined", typeof result.user === "boolean", typeof result.user === "number", typeof result.user === "string", typeof result.user === "bigint", typeof result.user === "symbol", typeof result.user === "function", typeof result.user === "object", result.user === null);
    console.log("process.threadCpuUsage.system:", typeof result.system === "undefined", typeof result.system === "boolean", typeof result.system === "number", typeof result.system === "string", typeof result.system === "bigint", typeof result.system === "symbol", typeof result.system === "function", typeof result.system === "object", result.system === null);
  } catch (error) {
    console.log("process.threadCpuUsage: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.threadCpuUsage();
    const again = process.threadCpuUsage();
    console.log("process.threadCpuUsage, form 2, does a second call answer the same thing:", result === again);
    console.log("process.threadCpuUsage, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("process.threadCpuUsage, form 2, the class:", Array.isArray(result), result instanceof Object, result instanceof Array, result instanceof Map, result instanceof Set, result instanceof Promise, result instanceof Date, result instanceof RegExp, result instanceof Error, result instanceof ArrayBuffer, result instanceof Uint8Array, result instanceof Function, ArrayBuffer.isView(result));
    console.log("process.threadCpuUsage, form 2, above it:", Object.getPrototypeOf(result) === Object.prototype, Object.getPrototypeOf(result) === Array.prototype, Object.getPrototypeOf(result) === null);
    console.log("process.threadCpuUsage, form 2, its state:", Object.isFrozen(result), Object.isSealed(result), Object.isExtensible(result));
    console.log("process.threadCpuUsage, form 2, names in it:", "length" in result, "size" in result, "then" in result, "next" in result, "constructor" in result, Symbol.iterator in result);
    {
      let asked = 0;
      for (const value of Object.values(result)) {
        if (asked++ === 4) break;
        console.log("process.threadCpuUsage, form 2, by Object.values:", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const [key, value] of Object.entries(result)) {
        if (asked++ === 4) break;
        console.log("process.threadCpuUsage, form 2, by Object.entries:", typeof key === "string", typeof value === "undefined", typeof value === "boolean", typeof value === "number", typeof value === "string", typeof value === "bigint", typeof value === "symbol", typeof value === "function", typeof value === "object", value === null);
      }
    }
    {
      let asked = 0;
      for (const key in result) {
        if (asked++ === 4) break;
        console.log("process.threadCpuUsage, form 2, by for-in:", typeof key === "string", typeof result[key] === "undefined", typeof result[key] === "boolean", typeof result[key] === "number", typeof result[key] === "string", typeof result[key] === "bigint", typeof result[key] === "symbol", typeof result[key] === "function", typeof result[key] === "object", result[key] === null);
      }
    }
    console.log("process.threadCpuUsage, form 2.user:", typeof result.user === "undefined", typeof result.user === "boolean", typeof result.user === "number", typeof result.user === "string", typeof result.user === "bigint", typeof result.user === "symbol", typeof result.user === "function", typeof result.user === "object", result.user === null);
    console.log("process.threadCpuUsage, form 2.system:", typeof result.system === "undefined", typeof result.system === "boolean", typeof result.system === "number", typeof result.system === "string", typeof result.system === "bigint", typeof result.system === "symbol", typeof result.system === "function", typeof result.system === "object", result.system === null);
  } catch (error) {
    console.log("process.threadCpuUsage, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.throwDeprecation;
    console.log("process.throwDeprecation, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.throwDeprecation, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.traceDeprecation;
    console.log("process.traceDeprecation, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.traceDeprecation, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.traceProcessWarnings;
    console.log("process.traceProcessWarnings, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.traceProcessWarnings, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.uptime();
    console.log("process.uptime:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.uptime: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.uptime();
    console.log("process.uptime, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.uptime, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process.version;
    console.log("process.version, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("process.version, get: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = process[Symbol.toStringTag];
    console.log("process[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("process[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("process[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
