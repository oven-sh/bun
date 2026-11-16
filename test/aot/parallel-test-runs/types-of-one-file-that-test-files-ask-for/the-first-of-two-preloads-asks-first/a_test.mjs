import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
import near from "./conf.txt" with { type: "text" };
console.log("behind two preloads:", show(globalThis.first), show(globalThis.second), show(near), near === globalThis.first);
test("runs", () => {});
