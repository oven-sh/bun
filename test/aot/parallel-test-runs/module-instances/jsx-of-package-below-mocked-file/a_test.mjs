// Elements that code of an earlier load creates come from the JSX runtime that this load was linked to.
import { test, vi } from "bun:test";
const show = (label, ns) => console.log(label, ns.view(), ns.arrow(), new ns.Widget().render(), new ns.Widget().keyed({}), ns.Widget.made(), [...ns.later()].join(), ns.nested(), globalThis.runtimes);
const kept = globalThis.kept ??= [];
const all = async label => { const ns = await import("./view.jsx"); kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("a", async () => {
  vi.doMock("my-jsx/config", () => ({ word: "am" }));
  await all("a");
});
