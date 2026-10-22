// validate<T>(value) keeps the symbol keys of a dictionary, also when T holds a Schema.Default.
import { validate } from "bun:bundle";
import type { Schema } from "bun";
type Counts = Record<string, number>;
const mark = Symbol("mark");
function dictionary(): any {
  const counts: any = JSON.parse('{"a":1}');
  counts[mark] = 2;
  return counts;
}
function argument(text: string): any {
  const value: any = JSON.parse(text);
  value.d = dictionary();
  value.e = dictionary();
  return value;
}

const plain: any = validate<{ d: Record<string, number>; n: number }>(argument('{"n":1}'));
console.log("without a default", plain.d[mark], Object.keys(plain.d).join());

const defaulted: any = validate<{ d: Record<string, number>; n: number & Schema.Default<1> }>(argument("{}"));
console.log("with a default", defaulted.d[mark], Object.keys(defaulted.d).join(), defaulted.n);

const twice: any = validate<{ d: Counts; e: Counts; n: number & Schema.Default<1> }>(argument("{}"));
console.log("a dictionary type used twice, with a default", twice.d[mark], twice.e[mark], twice.n);
