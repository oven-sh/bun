import { test } from "bun:test";
function ask(a: number) { const m = new Map([[a, 1]]); return Object.fromEntries(m)[a] + [...m.keys()].length + Array.from(m).length; }
test("map-group-and-from-entries", () => {
  let calls = 0; let seen: unknown = "";
  const real = Map.prototype.entries; Map.prototype.entries = function (this: Map<unknown, unknown>) { calls++; return real.call(this); } as any;
  try {
    for (let i = 0; i < 300; i++) seen = ask(i);
  } finally {
    Map.prototype.entries = real;
  }
  console.log(String(seen), calls);
});
