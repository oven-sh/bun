import { expect, test } from "bun:test";
import { conf } from "./holder.mjs";

const loaded = await import("./conf.toml", { with: { type: "text" } });
console.log(typeof conf, typeof loaded.default, Object.keys(loaded).sort().join());
test("the call and the statement get what each asks for", () => {
  expect([conf, loaded.default]).toEqual([{ port: 21 }, "port = 21\n"]);
});
