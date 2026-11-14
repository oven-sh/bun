import { expect, test } from "bun:test";

function* count(): Generator<number> {
  yield 1;
}
function args(..._: unknown[]): IArguments {
  return arguments;
}

test("a generator", () => {
  expect<unknown>(count()).toEqual([1]);
});
test("a generator with a property", () => {
  expect<unknown>(Object.assign(count(), { big: 1n })).toEqual({ big: 2n });
});
test("an arguments object", () => {
  expect<unknown>(args(1, 2n)).toEqual([1, 2n]);
});
test("a Proxy that holds itself", () => {
  const target: Record<string, unknown> = { big: 1n };
  target.self = target;
  expect<unknown>(new Proxy(target, {})).toEqual({ big: 2n });
});
