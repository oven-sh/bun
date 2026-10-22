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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.preventExtensions(first);
    console.log("Reflect.preventExtensions, is it an operand:", result === first);
    console.log("Reflect.preventExtensions:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.preventExtensions, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.preventExtensions: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const result = Reflect.preventExtensions(first);
    console.log("Reflect.preventExtensions, form 2, is it an operand:", result === first);
    console.log("Reflect.preventExtensions, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.preventExtensions, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.preventExtensions, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.preventExtensions(first);
    console.log("Reflect.preventExtensions, form 3, is it an operand:", result === first);
    console.log("Reflect.preventExtensions, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.preventExtensions, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.preventExtensions, form 3: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.set(first, "-", 3.5);
    console.log("Reflect.set, is it an operand:", result === first);
    console.log("Reflect.set:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.set, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.set: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const result = Reflect.set(first, "-", 3.5);
    console.log("Reflect.set, form 2, is it an operand:", result === first);
    console.log("Reflect.set, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.set, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.set, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.set(first, "-", item);
    console.log("Reflect.set, form 3, is it an operand:", result === first, result === item);
    console.log("Reflect.set, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.set, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.set, form 3: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.set(first, "-", 3.5);
    console.log("Reflect.set, form 4, is it an operand:", result === first);
    console.log("Reflect.set, form 4:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.set, form 4, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.set, form 4: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.setPrototypeOf(first, null);
    console.log("Reflect.setPrototypeOf, is it an operand:", result === first);
    console.log("Reflect.setPrototypeOf:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.setPrototypeOf, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.setPrototypeOf: it threw", error instanceof Error);
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
    const first = [1.5, item, "two"];
    const result = Reflect.setPrototypeOf(first, null);
    console.log("Reflect.setPrototypeOf, form 2, is it an operand:", result === first);
    console.log("Reflect.setPrototypeOf, form 2:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.setPrototypeOf, form 2, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.setPrototypeOf, form 2: it threw", error instanceof Error);
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
    const first = { first: 1.5, second: "two", third: item };
    const result = Reflect.setPrototypeOf(first, null);
    console.log("Reflect.setPrototypeOf, form 3, is it an operand:", result === first);
    console.log("Reflect.setPrototypeOf, form 3:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect.setPrototypeOf, form 3, the boolean:", result === true, result === false, !result);
  } catch (error) {
    console.log("Reflect.setPrototypeOf, form 3: it threw", error instanceof Error);
  }
})();
await (async function () {
  try {
    const result = Reflect[Symbol.toStringTag];
    console.log("Reflect[Symbol.toStringTag], get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
    console.log("Reflect[Symbol.toStringTag], get, the text:", result.length === 0, result === "");
  } catch (error) {
    console.log("Reflect[Symbol.toStringTag], get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
