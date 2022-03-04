import { it, expect } from "bun:test";

it("inspect", () => {
  expect(Bun.inspect(new TypeError("what")).includes("TypeError: what")).toBe(
    true
  );

  expect("hi").toBe("hi");
  expect(Bun.inspect(1)).toBe("1");
  expect(Bun.inspect(1, "hi")).toBe("1 hi");
  expect(Bun.inspect([])).toBe("[]");
  expect(Bun.inspect({})).toBe("{ }");
  var str = "123";
  while (str.length < 4096) {
    str += "123";
  }
  expect(Bun.inspect(str)).toBe(str);
});
