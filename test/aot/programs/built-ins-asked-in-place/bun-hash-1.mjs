// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.
// Some of what is made here is a promise that rejects, and nobody waits for it.
process.on("unhandledRejection", () => {});
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.adler32(first);
    console.log("Bun.hash.adler32, is it an operand:", result === first);
    console.log("Bun.hash.adler32, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.adler32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.adler32, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.adler32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.adler32(first);
    console.log("Bun.hash.adler32, form 2, is it an operand:", result === first);
    console.log("Bun.hash.adler32, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.adler32, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.adler32, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.adler32, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.hash.adler32(first);
    console.log("Bun.hash.adler32, form 3, is it an operand:", result === first);
    console.log("Bun.hash.adler32, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.adler32, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.adler32, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.adler32, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.cityHash32(first);
    console.log("Bun.hash.cityHash32, is it an operand:", result === first);
    console.log("Bun.hash.cityHash32, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.cityHash32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.cityHash32, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.cityHash32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.cityHash32(first);
    console.log("Bun.hash.cityHash32, form 2, is it an operand:", result === first);
    console.log("Bun.hash.cityHash32, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.cityHash32, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.cityHash32, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.cityHash32, form 2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.hash.cityHash32(first);
    console.log("Bun.hash.cityHash32, form 3, is it an operand:", result === first);
    console.log("Bun.hash.cityHash32, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.cityHash32, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.cityHash32, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.cityHash32, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.cityHash64(first, 2.5);
    console.log("Bun.hash.cityHash64, is it an operand:", result === first);
    console.log("Bun.hash.cityHash64:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.cityHash64: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.cityHash64(first, "-");
    console.log("Bun.hash.cityHash64, form 2, is it an operand:", result === first);
    console.log("Bun.hash.cityHash64, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.cityHash64, form 2: it threw", error instanceof Error);
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
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.cityHash64(first, item);
    console.log("Bun.hash.cityHash64, form 3, is it an operand:", result === first, result === item);
    console.log("Bun.hash.cityHash64, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.cityHash64, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.hash.cityHash64(first, 2.5);
    console.log("Bun.hash.cityHash64, form 4, is it an operand:", result === first);
    console.log("Bun.hash.cityHash64, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.cityHash64, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.crc32(first, 2.5);
    console.log("Bun.hash.crc32, is it an operand:", result === first);
    console.log("Bun.hash.crc32, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.crc32:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.crc32, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.crc32: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.crc32(first, "-");
    console.log("Bun.hash.crc32, form 2, is it an operand:", result === first);
    console.log("Bun.hash.crc32, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.crc32, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.crc32, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.crc32, form 2: it threw", error instanceof Error);
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
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.crc32(first, item);
    console.log("Bun.hash.crc32, form 3, is it an operand:", result === first, result === item);
    console.log("Bun.hash.crc32, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.crc32, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.crc32, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.crc32, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.hash.crc32(first, 2.5);
    console.log("Bun.hash.crc32, form 4, is it an operand:", result === first);
    console.log("Bun.hash.crc32, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.crc32, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.crc32, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.crc32, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.murmur32v2(first, 2.5);
    console.log("Bun.hash.murmur32v2, is it an operand:", result === first);
    console.log("Bun.hash.murmur32v2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.murmur32v2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.murmur32v2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.murmur32v2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.murmur32v2(first, "-");
    console.log("Bun.hash.murmur32v2, form 2, is it an operand:", result === first);
    console.log("Bun.hash.murmur32v2, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.murmur32v2, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.murmur32v2, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.murmur32v2, form 2: it threw", error instanceof Error);
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
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.murmur32v2(first, item);
    console.log("Bun.hash.murmur32v2, form 3, is it an operand:", result === first, result === item);
    console.log("Bun.hash.murmur32v2, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.murmur32v2, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.murmur32v2, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.murmur32v2, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.hash.murmur32v2(first, 2.5);
    console.log("Bun.hash.murmur32v2, form 4, is it an operand:", result === first);
    console.log("Bun.hash.murmur32v2, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.murmur32v2, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.murmur32v2, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.murmur32v2, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.murmur32v3(first, 2.5);
    console.log("Bun.hash.murmur32v3, is it an operand:", result === first);
    console.log("Bun.hash.murmur32v3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.murmur32v3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.murmur32v3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.murmur32v3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.murmur32v3(first, "-");
    console.log("Bun.hash.murmur32v3, form 2, is it an operand:", result === first);
    console.log("Bun.hash.murmur32v3, form 2, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.murmur32v3, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.murmur32v3, form 2, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.murmur32v3, form 2: it threw", error instanceof Error);
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
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.murmur32v3(first, item);
    console.log("Bun.hash.murmur32v3, form 3, is it an operand:", result === first, result === item);
    console.log("Bun.hash.murmur32v3, form 3, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.murmur32v3, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.murmur32v3, form 3, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.murmur32v3, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.hash.murmur32v3(first, 2.5);
    console.log("Bun.hash.murmur32v3, form 4, is it an operand:", result === first);
    console.log("Bun.hash.murmur32v3, form 4, does it lie where its row says:", typeof result !== "number" || (result >= 0 && result <= 4294967295));
    console.log("Bun.hash.murmur32v3, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Bun.hash.murmur32v3, form 4, the number:", Number.isInteger(result), result === result, result < 0, result > 2147483647, result < -2147483648, Object.is(result, -0), (result | 0) === result);
  } catch (error) {
    console.log("Bun.hash.murmur32v3, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.murmur64v2(first, 2.5);
    console.log("Bun.hash.murmur64v2, is it an operand:", result === first);
    console.log("Bun.hash.murmur64v2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.murmur64v2: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.murmur64v2(first, "-");
    console.log("Bun.hash.murmur64v2, form 2, is it an operand:", result === first);
    console.log("Bun.hash.murmur64v2, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.murmur64v2, form 2: it threw", error instanceof Error);
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
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.murmur64v2(first, item);
    console.log("Bun.hash.murmur64v2, form 3, is it an operand:", result === first, result === item);
    console.log("Bun.hash.murmur64v2, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.murmur64v2, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.hash.murmur64v2(first, 2.5);
    console.log("Bun.hash.murmur64v2, form 4, is it an operand:", result === first);
    console.log("Bun.hash.murmur64v2, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.murmur64v2, form 4: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.rapidhash(first, 2.5);
    console.log("Bun.hash.rapidhash, is it an operand:", result === first);
    console.log("Bun.hash.rapidhash:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.rapidhash: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.rapidhash(first, "-");
    console.log("Bun.hash.rapidhash, form 2, is it an operand:", result === first);
    console.log("Bun.hash.rapidhash, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.rapidhash, form 2: it threw", error instanceof Error);
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
    const first = new ArrayBuffer(8, { maxByteLength: 16 });
    const result = Bun.hash.rapidhash(first, item);
    console.log("Bun.hash.rapidhash, form 3, is it an operand:", result === first, result === item);
    console.log("Bun.hash.rapidhash, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.rapidhash, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const first = new ArrayBuffer(0);
    const result = Bun.hash.rapidhash(first, 2.5);
    console.log("Bun.hash.rapidhash, form 4, is it an operand:", result === first);
    console.log("Bun.hash.rapidhash, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("Bun.hash.rapidhash, form 4: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
