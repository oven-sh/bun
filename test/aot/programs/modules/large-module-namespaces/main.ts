// Module namespace objects as values: with one name, with thirty, with none, with `export *` of another module and of two, with a default, got by `import * as` and by `import()`:
// their keys in order, what the names yield, that they cannot be written, and that a name that is not exported is not there.
import * as many from "./many.ts";
import * as one from "./one.ts";
import * as none from "./none.ts";
import * as starred from "./starred.ts";
import * as changing from "./changing.ts";
const lines: string[] = [];
function describe(what: string, ns: Record<string, unknown>): void {
  const keys = Object.keys(ns);
  lines.push(what + ": " + keys.length + " names: " + keys.join() + " | " + keys.map((k) => typeof ns[k] === "function" ? "f" + (ns[k] as () => unknown)() : typeof ns[k] === "object" ? "{" + Object.keys(ns[k] as object).join() + "}" : String(ns[k])).join());
  lines.push(what + ": " + ("missing" in ns) + " " + String(ns.missing) + " " + keys.every((k) => k in ns) + " " + Object.getOwnPropertyNames(ns).join());
  try { (ns as any).added = 1; lines.push(what + ": written"); } catch (error) { lines.push(what + ": " + (error as Error).constructor.name); }
}
for (const [what, ns] of [["many", many], ["one", one], ["none", none], ["starred", starred], ["changing", changing]] as [string, Record<string, unknown>][]) describe(what, ns);
changing.bump(); changing.bump();
lines.push("changing.count " + changing.count + " " + (changing as Record<string, unknown>)["count"]);
lines.push("spread " + Object.keys({ ...many }).length + " " + JSON.stringify({ ...one }));
const late = await import("./late.ts");
describe("late", late as Record<string, unknown>);
lines.push("the same again " + ((await import("./late.ts")) === late) + " " + ((await import("./many.ts")) === many));
console.log(lines.join("\n"));
