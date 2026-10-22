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
    const list = [1.5, item, "two"];
    const result = list.concurrent;
    console.log("%ScopeFunctions%.prototype.concurrent, get, is it an operand:", result === list);
    console.log("%ScopeFunctions%.prototype.concurrent, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%ScopeFunctions%.prototype.concurrent, get: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const result = list.failing;
    console.log("%ScopeFunctions%.prototype.failing, get, is it an operand:", result === list);
    console.log("%ScopeFunctions%.prototype.failing, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%ScopeFunctions%.prototype.failing, get: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const result = list.only;
    console.log("%ScopeFunctions%.prototype.only, get, is it an operand:", result === list);
    console.log("%ScopeFunctions%.prototype.only, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%ScopeFunctions%.prototype.only, get: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const result = list.serial;
    console.log("%ScopeFunctions%.prototype.serial, get, is it an operand:", result === list);
    console.log("%ScopeFunctions%.prototype.serial, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%ScopeFunctions%.prototype.serial, get: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const result = list.skip;
    console.log("%ScopeFunctions%.prototype.skip, get, is it an operand:", result === list);
    console.log("%ScopeFunctions%.prototype.skip, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%ScopeFunctions%.prototype.skip, get: it threw", error instanceof Error);
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
    const list = [1.5, item, "two"];
    const result = list.todo;
    console.log("%ScopeFunctions%.prototype.todo, get, is it an operand:", result === list);
    console.log("%ScopeFunctions%.prototype.todo, get:", typeof result === "undefined", typeof result === "boolean", typeof result === "number", typeof result === "string", typeof result === "bigint", typeof result === "symbol", typeof result === "function", typeof result === "object", result === null);
  } catch (error) {
    console.log("%ScopeFunctions%.prototype.todo, get: it threw", error instanceof Error);
  }
})();
// A timer or a listener that was made on the way would keep the program alive.
process.exit(0);
