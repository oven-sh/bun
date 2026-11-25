import { test, mock } from "bun:test";
const read = (held: any, name: string) => { try { return String(held[name]); } catch { return "threw"; } };
const say = (at: string, held: any) => console.log("SAID", at, Object.keys(held).sort().join("+"), "|", Reflect.ownKeys(held).filter(key => typeof key === "string").sort().join("+"), "|", ["kept", "dropped", "added", "more", "other"].map(name => read(held, name) + " " + (name in held) + " " + Object.hasOwn(held, name) + " " + !!Object.getOwnPropertyDescriptor(held, name)).join(" . "), "|", read({ get fn() { return held.fn(); } }, "fn"));
test("t", async () => {
  mock.module("./lib.cjs", () => ({ kept: "first kept", fn: () => "first fn", added: "first added" }));
  await import("./lib.cjs");
  mock.module("./lib.cjs", () => ({ kept: "second kept", dropped: "second dropped", fn: () => "second fn", more: "second more" }));
  const barrel = await import("./barrel.ts");
  say("second", barrel);
});
