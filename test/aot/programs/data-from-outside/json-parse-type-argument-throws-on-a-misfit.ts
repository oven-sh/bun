// JSON.parse<T>(text) throws a TypeError with `issues` when the text is JSON and not a T, and the SyntaxError of JSON.parse(text) when it is not JSON.
import type { Schema } from "bun";
interface Item { sku: string & Schema.MaxLength<4>; quantity: number & Schema.Int & Schema.Min<1> & Schema.Max<99>; note?: string }
interface Order { id: number; items: Item[] & Schema.MinItems<1>; to: { name: string; city: string }; kind: "gift" | "plain"; coupon: string | null }
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };

function attempt(what: string, parse: () => unknown): void {
  try {
    console.log(what, "accepted", JSON.stringify(parse()));
  } catch (error: any) {
    console.log(what, error instanceof TypeError ? "TypeError" : error instanceof SyntaxError ? "SyntaxError" : "other", error.message, JSON.stringify(error.issues));
  }
}
const order = { id: 7, items: [{ sku: "a", quantity: 1 }], to: { name: "n", city: "c" }, kind: "gift", coupon: null };
const orders: [string, unknown][] = [
  ["as it should be", order],
  ["a required property is missing", { ...order, id: undefined }],
  ["a number is a string", { ...order, id: "7" }],
  ["null for an object", { ...order, to: null }],
  ["an array for an object", { ...order, to: [] }],
  ["an object for an array", { ...order, items: {} }],
  ["below, in an array", { ...order, items: [{ sku: "a", quantity: 1 }, { sku: "b", quantity: "2" }] }],
  ["two things at once", { ...order, id: null, to: { name: 1, city: "c" } }],
  ["no member of a union of literals", { ...order, kind: "other" }],
  ["an optional property of another kind", { ...order, items: [{ sku: "a", quantity: 1, note: 5 }] }],
  ["an optional property that is null", { ...order, items: [{ sku: "a", quantity: 1, note: null }] }],
  ["too long", { ...order, items: [{ sku: "abcde", quantity: 1 }] }],
  ["not whole", { ...order, items: [{ sku: "a", quantity: 1.5 }] }],
  ["too small, too big", { ...order, items: [{ sku: "a", quantity: 0 }, { sku: "a", quantity: 100 }] }],
  ["too few", { ...order, items: [] }],
  ["more than is declared", { extra: 1, ...order, more: [1] }],
];
for (const [what, value] of orders) attempt(what, () => JSON.parse<Order>(JSON.stringify(value)));
attempt("the root is of another kind", () => JSON.parse<Order>("[]"));
attempt("the root is null", () => JSON.parse<Order>("null"));
attempt("a number too large for a double", () => JSON.parse<{ n: number }>('{"n":1e400}'));
attempt("the later of two wins, and fits", () => JSON.parse<{ n: number }>('{"n":"x","n":1}'));
attempt("the later of two wins, and does not fit", () => JSON.parse<{ n: number }>('{"n":1,"n":"x"}'));
attempt("no arm of a union", () => JSON.parse<Shape>('{"kind":"circle","side":1}'));
attempt("no arm of a union by its tag", () => JSON.parse<Shape>('{"kind":"line"}'));
attempt("a tuple of another length", () => JSON.parse<[number, string]>("[1]"));
attempt("a value of a dictionary", () => JSON.parse<Record<string, number>>('{"a":1,"b":"2"}'));
attempt("a primitive", () => JSON.parse<number>('"1"'));
attempt("strict, as declared", () => JSON.parse<{ a: number } & Schema.Strict>('{"a":1}'));
attempt("strict, with more", () => JSON.parse<{ a: number } & Schema.Strict>('{"a":1,"b":2}'));
attempt("a reviver makes it fit", () => JSON.parse<{ a: number }>('{"a":"1"}', (key, value) => (key === "a" ? Number(value) : value)));
attempt("a reviver makes it misfit", () => JSON.parse<{ a: number }>('{"a":1}', (key, value) => (key === "a" ? String(value) : value)));
for (const text of ["", "{", '{"id":7', '{"id":7,}', "[1,]", "nul", '{"id":7} x', "{'id':7}", '{"id":07}', '"\n"', "﻿{}"]) {
  let plain = "";
  try {
    JSON.parse(text);
  } catch (error: any) {
    plain = error.name + ": " + error.message;
  }
  let typed = "";
  try {
    JSON.parse<Order>(text);
  } catch (error: any) {
    typed = error.name + ": " + error.message;
  }
  console.log(JSON.stringify(text), typed === plain, typed);
}
