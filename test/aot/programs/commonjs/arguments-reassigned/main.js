// Sloppy functions that assign to `arguments`: the variable changes, and the object that mapped parameters live in stays. Stores in branches, loops, `try`, arrows and direct eval. Plain Bun's transpiler rejects a store to `arguments` in sloppy code too, so the expected output follows ECMAScript.
import * as sloppy from "./sloppy.cjs";
for (const name of Object.keys(sloppy).sort()) {
  const f = sloppy[name];
  if (typeof f !== "function") continue;
  for (const list of [[], [1], [1, 2], ["a", { b: 1 }, [3]], [undefined, null]]) {
    let shown;
    try { shown = JSON.stringify(f(...list)) ?? "undefined"; } catch (e) { shown = "threw " + e.name + ": " + e.message; }
    console.log(name + "(" + JSON.stringify(list).slice(1, -1) + "): " + shown);
  }
}
