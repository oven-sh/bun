// Where several arms of a union accept a value, the arm that is written first builds it: each arm here fills in its own name. The names of the types, which the checker sorts a union by, make no difference, nor does the place where the union is written: the type argument, an alias, another file, a member, an element, a type argument of an alias or an interface.
import type { Schema } from "bun";
import { validate } from "bun:bundle";
import type { Abe, AbeThenZed, Holder, Zed, ZedThenAbe } from "./types.ts";

type Either<First, Second> = First | Second;
type OrNull<T> = T | null;
type Wider = AbeThenZed | { a: number; b: number; by: string & Schema.Default<"a third"> };
type Sized = { a: number; by: string & Schema.Default<"Sized"> };

const one = '{"a":1}';
const show = (value: unknown) => JSON.stringify(value);
const rows: [string, () => unknown][] = [
  ["Zed | Abe", () => JSON.parse<Zed | Abe>(one)],
  ["Abe | Zed", () => JSON.parse<Abe | Zed>(one)],
  ["an alias, Zed first", () => JSON.parse<ZedThenAbe>(one)],
  ["an alias, Abe first", () => JSON.parse<AbeThenZed>(one)],
  ["an alias in a union", () => JSON.parse<Wider>(one)],
  ["a union in front of an alias", () => JSON.parse<Zed | AbeThenZed>(one)],
  ["arguments of an alias, Zed first", () => JSON.parse<Either<Zed, Abe>>(one)],
  ["arguments of an alias, Abe first", () => JSON.parse<Either<Abe, Zed>>(one)],
  ["a union as an argument", () => JSON.parse<OrNull<Zed | Abe>>(one)],
  ["an argument of an interface", () => JSON.parse<Holder<Zed>>('{"held":{"a":1}}')],
  ["a member", () => JSON.parse<{ x: Zed | Abe; y: Abe | Zed | null }>('{"x":{"a":1},"y":{"a":1}}')],
  ["an optional member", () => JSON.parse<{ x?: Zed | Abe }>('{"x":{"a":1}}')],
  ["every member made optional", () => JSON.parse<Partial<{ x: Zed | Abe }>>('{"x":{"a":1}}')],
  ["elements", () => JSON.parse<(Zed | Abe)[]>("[" + one + "," + one + "]")],
  ["elements of a tuple", () => JSON.parse<[Zed | Abe, Abe | null | Zed]>("[" + one + "," + one + "]")],
  ["values of a dictionary", () => JSON.parse<Record<string, Zed | Abe>>('{"k":{"a":1}}')],
  ["a record, then a dictionary", () => JSON.parse<Sized | Record<string, number>>(one)],
  ["a dictionary, then a record", () => JSON.parse<Record<string, number> | Sized>(one)],
  ["a record, then any object", () => JSON.parse<Sized | object>(one)],
  ["any object, then a record", () => JSON.parse<object | Sized>(one)],
  ["arrays", () => JSON.parse<Zed[] | Abe[]>("[" + one + "]")],
  ["arrays the other way", () => JSON.parse<Abe[] | Zed[]>("[" + one + "]")],
  ["a union made strict", () => JSON.parse<(Zed | Abe) & Schema.Strict>(one)],
  ["a union made strict, the other way", () => JSON.parse<(Abe | Zed) & Schema.Strict>(one)],
  ["defaults of a member that is missing", () => JSON.parse<{ n: (number & Schema.Default<2>) | (number & Schema.Default<1>) }>("{}")],
  ["validate, Zed | Abe", () => validate<Zed | Abe>({ a: 1 })],
  ["validate, Abe | Zed", () => validate<Abe | Zed>({ a: 1 })],
  ["validate, plain data", () => validate<{ x: Zed | Abe }>(JSON.parse('{"x":{"a":1}}'))],
  ["validate, an alias", () => validate<AbeThenZed>(JSON.parse(one))],
];
for (const [label, run] of rows) console.log(label + ":", show(run()));
