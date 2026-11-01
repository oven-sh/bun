// A type of ten members is given 125,000 texts, each with its keys in another order, and every object is kept: more orders than the table of a typed object's key orders holds. Each object lists its keys as the text had them, then and at the end.
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

const parsed = campaign("parsed", text => JSON.parse(text) as Ten, 60_000, 0);
const more = campaign("parsed, further", text => JSON.parse(text) as Ten, 50_000, 60_000);
const annotated = campaign("an annotated variable", text => { const ten: Ten = JSON.parse(text); return ten; }, 10_000, 2_000_000);
const known = campaign("orders seen before", text => JSON.parse(text) as Ten, 5_000, 58_000);
again("parsed", parsed, 0);
again("parsed, further", more, 60_000);
again("an annotated variable", annotated, 2_000_000);
again("orders seen before", known, 58_000);
