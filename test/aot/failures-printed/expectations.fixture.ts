import { expect, mock } from "bun:test";
import { describe, it, test } from "../harness/declare";

function check(value: number, wanted: number): void {
  expect(value).toBe(wanted);
}
const checkLater = async (value: string): Promise<void> => {
  await Promise.resolve();
  expect(value).toEqual("right");
};
class Account {
  constructor(
    public owner: string,
    public cents: number,
  ) {}
  verify(): void {
    expect(this.cents).toBeGreaterThan(100);
  }
}

describe("numbers", () => {
  it("toBe", () => {
    expect(1 + 1).toBe(3);
  });
  it("toBe in a helper", () => {
    check(2, 5);
  });
  it("toBeCloseTo", () => {
    expect(0.1 + 0.2).toBeCloseTo(0.4, 5);
  });
  it("in a method", () => {
    new Account("ada", 5).verify();
  });
});

describe("objects", () => {
  describe("nested", () => {
    it("toEqual", () => {
      expect({ a: 1, b: [1, 2, 3], c: { d: "x" } }).toEqual({ a: 1, b: [1, 2, 4], c: { d: "y" } });
    });
    it("toStrictEqual", () => {
      expect<object>({ a: undefined, b: 2 }).toStrictEqual({ b: 2 });
    });
    it("toMatchObject", () => {
      expect({ name: "ada", age: 36, tags: ["a"] }).toMatchObject({ name: "bob", tags: ["a", "b"] });
    });
  });
  it("toHaveProperty", () => {
    expect({ a: { b: 1 } }).toHaveProperty("a.c", 2);
  });
  it("toContain", () => {
    expect(["a", "b"]).toContain("z");
  });
  it("toHaveLength", () => {
    expect([1, 2, 3]).toHaveLength(2);
  });
  it("toBeInstanceOf", () => {
    expect(new Account("a", 1)).toBeInstanceOf(Map);
  });
  it("not", () => {
    expect("text").not.toBe("text");
  });
});

describe("strings", () => {
  it("toMatch", () => {
    expect("hello world").toMatch(/^world/);
  });
  it("long texts", () => {
    expect("line one\nline two\nline three\n").toBe("line one\nline 2\nline three\n");
  });
  it("async helper", async () => {
    await checkLater("wrong");
  });
});

describe("functions", () => {
  it("toThrow none", () => {
    expect(() => 1).toThrow();
  });
  it("toThrow other message", () => {
    expect(() => {
      throw new Error("real message");
    }).toThrow("wanted message");
  });
  it("toThrow other class", () => {
    expect(() => {
      throw new RangeError("out");
    }).toThrow(TypeError);
  });
  it("not toThrow", () => {
    expect(() => {
      throw new Error("thrown");
    }).not.toThrow();
  });
  it("toHaveBeenCalledTimes", () => {
    const f = mock((x: number) => x);
    f(1);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("toHaveBeenCalledWith", () => {
    const f = mock((x: number, y: string) => x + y);
    f(1, "a");
    f(2, "b");
    expect(f).toHaveBeenCalledWith(3, "c");
  });
});

describe("promises", () => {
  it("resolves", async () => {
    await expect(Promise.resolve(1)).resolves.toBe(2);
  });
  it("rejects but resolved", async () => {
    await expect(Promise.resolve(1)).rejects.toThrow();
  });
  it("resolves but rejected", async () => {
    await expect(Promise.reject<number>(new Error("no"))).resolves.toBe(1);
  });
});

test("with a message", () => {
  expect(1, "one is not two").toBe(2);
});
test("expect.assertions", () => {
  expect.assertions(2);
  expect(1).toBe(1);
});
test("expect.hasAssertions", () => {
  expect.hasAssertions();
});
test.each([
  [1, 2, 4],
  [2, 2, 4],
  [3, 3, 7],
])("add %i %i", (a, b, sum) => {
  expect(a + b).toBe(sum);
});
test.failing("failing that passes", () => {
  expect(1).toBe(1);
});
test.todo("todo without a body");
test.skip("skipped", () => {
  expect(1).toBe(2);
});
test("passes", () => {
  expect(1).toBe(1);
});
