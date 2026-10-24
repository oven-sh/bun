import * as ns from "./a.mjs";
globalThis.kept = ns;
for (const read of [() => ns.f(), () => ns.own, () => Object.keys(ns).join()]) {
  try {
    console.log("d", read());
  } catch (error) {
    console.log("d", error.constructor.name);
  }
}
