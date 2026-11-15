import { test } from "bun:test";
function ask() { const re = /a/g; return re.flags; }
test("flags-reads-global", () => {
  let calls = 0; let seen: unknown = "";
  const real = Object.getOwnPropertyDescriptor(RegExp.prototype, "global")!; Object.defineProperty(RegExp.prototype, "global", { get() { calls++; return false; }, configurable: true });
  try {
    for (let i = 0; i < 300; i++) seen = ask();
  } finally {
    Object.defineProperty(RegExp.prototype, "global", real);
  }
  console.log(String(seen), calls);
});
