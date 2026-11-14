// Elements that code of an earlier load creates come from the mock of the JSX runtime that this load saw.
import { test, vi } from "bun:test";
const show = (label, ns) => console.log(label, ns.view(), ns.arrow(), new ns.Widget().render(), new ns.Widget().keyed({}), ns.Widget.made(), [...ns.later()].join(), ns.nested(), globalThis.runtimes);
const kept = globalThis.kept ??= [];
const all = async label => { const ns = await import("./view.jsx"); kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("a", async () => {
  vi.doMock("my-jsx/jsx-runtime", () => { const make = tag => ({ toString: () => tag + ":am" }); return { jsx: make, jsxs: make, jsxDEV: make, Fragment: "Fam", createElement: make }; });
  vi.doMock("my-jsx/jsx-dev-runtime", () => { const make = tag => ({ toString: () => tag + ":am" }); return { jsx: make, jsxs: make, jsxDEV: make, Fragment: "Fam", createElement: make }; });
  await all("a");
});
