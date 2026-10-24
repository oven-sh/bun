// Sloppy functions that keep `arguments` in a variable and only read it: by numbers, by keys that may be anything (`callee`, `length`, a symbol), through `apply`. The object is not made unless a key asks for it.
import * as sloppy from "./sloppy.cjs";
for (const name of Object.keys(sloppy).sort()) {
  const f = (sloppy as any)[name];
  if (typeof f !== "function") continue;
  for (const list of [[], [1], [1, 2], [1, 2, 3], ["callee", { b: 1 }, [3], 4], ["length", null], [undefined, "0"], [1.5, -1], ["1", "toString"]]) {
    let shown: string;
    try { shown = JSON.stringify(f(...list)) ?? "undefined"; } catch (e: any) { shown = "threw " + e.name + ": " + e.message; }
    console.log(name + "(" + JSON.stringify(list).slice(1, -1) + "): " + shown);
  }
}
