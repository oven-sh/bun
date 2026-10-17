// Sloppy functions whose parameters and `arguments[i]` are one variable: reads and stores of the parameters, through the object, from inner functions, in loops and across collections.
import * as sloppy from "./sloppy.cjs";
for (const name of Object.keys(sloppy).sort()) {
  const f = (sloppy as any)[name];
  if (typeof f !== "function") continue;
  for (const list of [[], [1], [1, 2], [1, 2, 3], ["a", { b: 1 }, [3], 4], [undefined, null]]) {
    let shown: string;
    try { shown = JSON.stringify(f(...list)) ?? "undefined"; } catch (e: any) { shown = "threw " + e.name + ": " + e.message; }
    console.log(name + "(" + JSON.stringify(list).slice(1, -1) + "): " + shown);
  }
}
