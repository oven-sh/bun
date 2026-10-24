import { total, add, walk, doubled, firstTwo, Basket } from "./uses.mjs";
import old from "./old-uses.cjs";
import * as lists from "./lists.mjs";
import moreLists from "./more-lists.cjs";
import shared, { replaceShared } from "./shared.mjs";

function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

const uses = { total, add, walk, doubled, firstTwo, oldTotal: old.total, oldAdd: old.add, oldWalk: old.walk, inABasket: list => new Basket(list).summary() };

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use](lists.honest());

for (const [name, make] of [...Object.entries(lists), ...Object.entries(moreLists)]) {
  if (typeof make !== "function" || name === "replaceCurrent") continue;
  for (const use in uses) attempt(name + ", " + use, () => uses[use](make()));
}

attempt("direct calls with the honest list", () => [total(lists.honest()), add(lists.honest()), walk(lists.honest()), old.total(lists.honest())]);
attempt("direct calls with the array-like", () => [total(lists.arrayLike()), walk(moreLists.set()), old.total(lists.text())]);
attempt("a direct call with the subclass", () => add(lists.subclass()));
attempt("the shared list", () => [total(shared.list), add(shared.list)]);
replaceShared({ 0: 7, length: 1, push: () => "replaced push" });
attempt("the shared list after another module replaced it", () => [total(shared.list), add(shared.list)]);
replaceShared("78");
attempt("the shared list after it became text", () => [total(shared.list), walk(shared.list)]);
attempt("the exported binding", () => [lists.current.length, total(lists.current)]);
lists.replaceCurrent(new Set([1]));
attempt("the exported binding after its module replaced it", () => [lists.current.length, walk(lists.current)]);
