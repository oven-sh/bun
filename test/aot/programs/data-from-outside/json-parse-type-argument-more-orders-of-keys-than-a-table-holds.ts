// A type of ten members is given 130,000 texts, each with its keys in another order, and every object is kept: more orders than the table of a typed object's key orders holds. Each object lists its keys as the text had them, then and at the end.
import { JSON } from "bun"; import { validate } from "bun:bundle";
type Ten = { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; i: number; j: number };
const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

function permutation(number: number): string[] {
  const left = [...names];
  const order: string[] = [];
  for (let size = left.length; size > 0; size--) {
    order.push(left.splice(number % size, 1)[0]);
    number = Math.floor(number / size);
  }
  return order;
}
const textOf = (order: string[]) => "{" + order.map((name, at) => '"' + name + '":' + at).join(",") + "}";

function campaign(label: string, make: (text: string) => Ten, total: number, from: number): Ten[] {
  let wrong = 0;
  const kept: Ten[] = [];
  for (let number = 0; number < total; number++) {
    const order = permutation(from + number);
    const value = make(textOf(order));
    if (Object.keys(value).join() !== order.join() || value.a !== order.indexOf("a") || value.j !== order.indexOf("j")) wrong++;
    kept.push(value);
  }
  console.log(label + ": " + total + " orders: " + wrong + " wrong");
  return kept;
}
function again(label: string, kept: Ten[], from: number): void {
  let wrong = 0;
  kept.forEach((value, at) => {
    if (JSON.stringify(value) !== textOf(permutation(from + at))) wrong++;
  });
  console.log(label + ", at the end: " + wrong + " wrong");
}

const parsed = campaign("JSON.parse<Ten>", text => JSON.parse<Ten>(text), 60_000, 0);
const more = campaign("JSON.parse<Ten>, further", text => JSON.parse<Ten>(text), 50_000, 60_000);
const validated = campaign("validate<Ten>", text => validate<Ten>(globalThis.JSON.parse(text)), 10_000, 1_000_000);
const cast = campaign("as Ten", text => globalThis.JSON.parse(text) as Ten, 10_000, 2_000_000);
const known = campaign("orders seen before", text => JSON.parse<Ten>(text), 5_000, 58_000);
again("JSON.parse<Ten>", parsed, 0);
again("JSON.parse<Ten>, further", more, 60_000);
again("validate<Ten>", validated, 1_000_000);
again("as Ten", cast, 2_000_000);
again("orders seen before", known, 58_000);
