import { test, vi } from "bun:test";
const show = (label, ns) => console.log(label, ns.view(), ns.arrow(), new ns.Widget().render(), new ns.Widget().keyed({}), ns.Widget.made(), [...ns.later()].join(), ns.nested(), globalThis.runtimes);
const kept = globalThis.kept ??= [];
const all = async label => { const ns = await import("./view.jsx"); kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("c", async () => {
  await all("c");
  vi.doMock("my-jsx/jsx-runtime", () => { const make = tag => ({ toString: () => tag + ":cm" }); return { jsx: make, jsxs: make, jsxDEV: make, Fragment: "Fcm", createElement: make }; });
  vi.doMock("my-jsx/jsx-dev-runtime", () => { const make = tag => ({ toString: () => tag + ":cm" }); return { jsx: make, jsxs: make, jsxDEV: make, Fragment: "Fcm", createElement: make }; });
  await all("cm");
});
