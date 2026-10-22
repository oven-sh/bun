import main, { table, helper, Thing, counter, loose, declared } from "./first.mjs";
import * as all from "./first.mjs";
const attempt = (name, f) => { try { return name + ": " + f(); } catch (e) { return name + ": " + e.name; } };
export function look(when) {
  return [
    attempt(when + " table", () => table.a), attempt(when + " helper", () => helper()), attempt(when + " class", () => new Thing().n), attempt(when + " counter", () => counter),
    attempt(when + " var", () => String(loose)), attempt(when + " declared", () => declared()), attempt(when + " default", () => main.kind),
    attempt(when + " namespace keys", () => Object.keys(all).join()), attempt(when + " namespace read", () => all.table.a), attempt(when + " namespace has", () => "table" in all),
    attempt(when + " namespace descriptor", () => typeof Object.getOwnPropertyDescriptor(all, "helper").value),
  ];
}
export const seenEarly = look("early");
