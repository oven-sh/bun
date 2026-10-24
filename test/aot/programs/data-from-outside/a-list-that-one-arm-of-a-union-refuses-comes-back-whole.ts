// One arm of a union looks at a list and refuses it, another arm says nothing about that list and takes the value. What comes back holds the whole list.
import { JSON as Checked, type Schema } from "bun";
import { validate } from "bun:bundle";

function show(name: string, run: () => unknown): void {
  try {
    console.log(name + ": " + JSON.stringify(run()));
  } catch (error: any) {
    console.log(name + ": " + error.name + ": " + error.message);
  }
}

type AtMostOne = { a: number[] & Schema.MaxItems<1> } | {};
type Numbers = { a: number[] } | {};
type Triple = { a: [boolean, number, string] } | {};
type Inner = { inner: { a: number[] & Schema.MaxItems<2> } | { b?: number } };
type Below = { a: { b: number[] } } | {};
type Rows = { rows: { b: number[] }[] | unknown };
type Table = Record<string, number[]> | {};
type Lists = { a: number[][] } | {};
type Other = { a: number[]; kind: "numbers" } | { kind: string };

show("too long for the first arm", () => validate<AtMostOne>({ a: [1, 2, 3] }));
show("the second element is no number", () => validate<Numbers>({ a: [1, "x", 3] }));
show("the last element is no number", () => validate<Numbers>({ a: [1, 2, "x"] }));
show("the first element of a tuple is wrong", () => validate<Triple>({ a: [1, 2, "x"] }));
show("a tuple that is too short", () => validate<Triple>({ a: [true, 2] }));
show("a tuple that is too long", () => validate<Triple>({ a: [true, 2, "x", 4] }));
show("in a member", () => validate<Inner>({ inner: { a: [1, 2, 3, 4, 5] } }));
show("one object further down", () => validate<Below>({ a: { b: [1, "x", 3], c: [4, 5] } }));
show("in the second row", () => validate<Rows>({ rows: [{ b: [1, 2] }, { b: [3, "x", 5] }, { b: [6] }] }));
show("under the second key", () => validate<Table>({ first: [1, 2], second: [3, "x", 5], third: [6, 7] }));
show("in the second list", () =>
  validate<Lists>({
    a: [
      [1, 2],
      [3, "x", 5],
      [6, 7],
    ],
  }),
);
show("beside a tag", () => validate<Other>({ a: [1, "x", 3], kind: "numbers" }));
show("a list with holes", () => validate<Numbers>({ a: [1, "x", , 4] }));
show("a list that the first arm takes", () => validate<Numbers>({ a: [1, 2, 3] }));

show("a text, the name spelled with an escape", () => Checked.parse<Numbers>('{"\\u0061":[1,"x",3]}'));
show("a text, the name written twice", () => Checked.parse<Numbers>('{"a":0,"a":[1,"x",3]}'));
show("a text, too long for the first arm", () => Checked.parse<AtMostOne>('{"\\u0061":[1,2,3]}'));
show("a text, in a member", () => Checked.parse<Inner>('{"\\u0069nner":{"a":[1,2,3,4,5]}}'));
show("a text, plainly spelled", () => Checked.parse<Numbers>('{"a":[1,"x",3]}'));
