import { expect } from "bun:test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, test } from "../harness/declare";

class HttpError extends Error {
  name = "HttpError";
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function inner(depth: number): number {
  if (depth === 0) throw new Error("thrown three calls down");
  return inner(depth - 1) + 1;
}
function outer(): number {
  return inner(2) * 2;
}
const arrow = (): never => {
  throw new TypeError("thrown by an arrow");
};
const holder = {
  method(): void {
    arrow();
  },
  get reader(): number {
    throw new RangeError("thrown by a getter");
  },
};
describe("errors", () => {
  it("an Error", () => {
    throw new Error("plain message");
  });
  it("down the stack", () => {
    outer();
  });
  it("through a method", () => {
    holder.method();
  });
  it("through a getter", () => {
    expect(holder.reader).toBe(1);
  });
  it("a class of its own", () => {
    throw new HttpError(404, "not found");
  });
  it("with a cause", () => {
    throw new Error("outer failure", { cause: new Error("inner failure") });
  });
  it("an AggregateError", () => {
    throw new AggregateError([new Error("first"), new TypeError("second")], "several");
  });
  it("with more members", () => {
    throw Object.assign(new Error("has a code"), { code: "E_CODE", detail: { a: 1 } });
  });
  it("many lines", () => {
    throw new Error("first line\nsecond line\nthird line");
  });
  it("no message", () => {
    throw new Error();
  });
});

describe("what is no Error", () => {
  it("a string", () => {
    throw "a thrown string";
  });
  it("a number", () => {
    throw 42;
  });
  it("an object", () => {
    throw { reason: "an object", list: [1, 2] };
  });
  it("undefined", () => {
    throw undefined;
  });
  it("null", () => {
    throw null;
  });
});

describe("from the engine", () => {
  it("JSON.parse", () => {
    JSON.parse("{ broken");
  });
  it("too much recursion", () => {
    const forever = (n: number): number => forever(n + 1) + 1;
    forever(0);
  });
  it("assignment to a constant", () => {
    const frozen = Object.freeze({ a: 1 });
    (frozen as { a: number }).a = 2;
  });
  it("in a callback of a built-in", () => {
    [1, 2, 3].map(n => {
      if (n === 2) throw new Error("in map");
      return n;
    });
  });
});

describe("hooks", () => {
  describe("beforeEach throws", () => {
    beforeEach(() => {
      throw new Error("from beforeEach");
    });
    it("is not run", () => {});
  });
  describe("afterEach throws", () => {
    afterEach(() => {
      throw new Error("from afterEach");
    });
    it("passes by itself", () => {});
  });
  describe("beforeAll throws", () => {
    beforeAll(() => {
      throw new Error("from beforeAll");
    });
    it("is not run either", () => {});
  });
  describe("afterAll throws", () => {
    afterAll(() => {
      throw new Error("from afterAll");
    });
    it("passes too", () => {});
  });
});

test("passes", () => {});
