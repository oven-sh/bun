import { test } from "bun:test";
test("a trap that the handler inherits", () => {
  let calls = 0;
  Object.prototype.defineProperty = function (target, key, descriptor) {
    calls++;
    return Reflect.defineProperty(target, key, descriptor);
  };
  try {
    const target = { width: 1 };
    const handler = { label: "plain" };
    const proxy = new Proxy(target, handler);
    for (let i = 0; i < 300; i++) proxy.width = i;
    console.log(calls, target.width);
  } finally {
    delete Object.prototype.defineProperty;
  }
});
