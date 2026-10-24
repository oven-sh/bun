// Functions whose parameter is a pattern, called with object literals, with objects made elsewhere, by value, with nothing: what they see and what a stack trace says.
interface Options {
  first: number;
  second: string;
  third?: number;
  fourth?: number[];
}
let log: string[] = [];

function plain({ first, second }: Options): string {
  let text = "";
  for (let i = 0; i < first; i++) text += second;
  return text + first;
}
function optional({ first, third, fourth }: Options): string {
  let sum = first;
  if (fourth) for (const n of fourth) sum += n;
  return sum + ":" + third;
}
function withOthers(before: number, { first, second }: Options, after: string): string {
  let text = after;
  for (let i = 0; i < before; i++) text += second + first;
  return text;
}
function renamed({ first: count, second: word }: Options): string {
  let text = "";
  for (let i = 0; i < count; i++) text += word + i;
  return text;
}
function storesToItsVariables({ first, second }: Options): string {
  first += 2;
  second += "!";
  let text = "";
  for (let i = 0; i < first; i++) text += second;
  return text;
}
function callsBack({ first, second }: Options, callback: () => void): string {
  callback();
  let text = "";
  for (let i = 0; i < first; i++) text += second;
  return text;
}
function fails({ first, second }: Options): string {
  let text = second;
  for (let i = 0; i < first; i++) text += i;
  throw new Error(text);
}
function recursive({ first, second }: Options): string {
  let text = second;
  for (let i = 0; i < first; i++) text += i;
  return first > 0 ? text + recursive({ first: first - 1, second }) : text;
}
const arrow = ({ first, second }: Options): string => {
  let text = "";
  for (let i = 0; i < first; i++) text += second + "-";
  return text;
};
class Printer {
  prefix = ">";
  print({ first, second }: Options): string {
    let text = this.prefix;
    for (let i = 0; i < first; i++) text += second;
    return text;
  }
  static make({ first, second }: Options): string {
    let text = "static";
    for (let i = 0; i < first; i++) text += second;
    return text;
  }
}
function makesObject({ first, second }: Options): { text: string; length: number } {
  let text = "";
  for (let i = 0; i < first; i++) text += second;
  return { text, length: text.length };
}
function order(name: string, value: number): number {
  log.push(name);
  return value;
}
function frames(error: unknown): string {
  return String((error as Error).stack)
    .split("\n")
    .map(line => /^\s*at (?:async )?([A-Za-z.<>]+) \(/.exec(line)?.[1] ?? /^([A-Za-z.<>]*)@/.exec(line)?.[1] ?? "")
    .filter(name => name !== "")
    .slice(0, 3)
    .join(" < ");
}

function literals(): void {
  console.log(plain({ first: 2, second: "ab" }));
  console.log(optional({ first: 1, second: "x" }), optional({ first: 1, second: "x", third: 3 }), optional({ first: 1, second: "x", fourth: [4, 5] }));
  console.log(withOthers(2, { first: 7, second: "s" }, "end"));
  console.log(renamed({ first: 2, second: "w" }));
  console.log(storesToItsVariables({ first: 1, second: "z" }));
  console.log(recursive({ first: 2, second: "r" }));
  console.log(arrow({ first: 2, second: "a" }));
  console.log(new Printer().print({ first: 2, second: "p" }), Printer.make({ first: 1, second: "q" }));
  const made = makesObject({ first: 3, second: "m" });
  console.log(made.text, made.length);
  console.log(plain({ second: String(order("second", 1)), first: order("first", 2) }), log.join());
}
function objectsMadeElsewhere(): void {
  const shared: Options = { first: 2, second: "cd" };
  console.log(plain(shared), plain(shared), shared.first, shared.second);
  console.log(storesToItsVariables(shared), shared.first, shared.second);
  console.log(
    callsBack(shared, () => {
      shared.first = 5;
      shared.second = "changed";
    }),
    shared.first,
    shared.second,
  );
  const list: Options[] = [{ first: 1, second: "l" }, { first: 2, second: "m", third: 9 }];
  console.log(list.map(plain).join(), list.map(each => optional(each)).join());
}
function byValue(): void {
  const functions = [plain, renamed, arrow];
  for (const each of functions) console.log(each({ first: 2, second: "v" }), each.length, each.name);
  console.log(plain.call(undefined, { first: 1, second: "c" }), plain.apply(undefined, [{ first: 1, second: "d" }]));
  console.log((plain as (options: unknown) => string)({ first: 1, second: "untyped", more: true }));
}
function nothing(): void {
  for (const value of [undefined, null]) {
    try {
      (plain as (options: unknown) => string)(value);
    } catch (error) {
      console.log((error as Error).constructor.name, frames(error));
    }
  }
}
function traces(): void {
  try {
    fails({ first: 2, second: "t" });
  } catch (error) {
    console.log((error as Error).message, frames(error));
  }
  const shared: Options = { first: 1, second: "u" };
  try {
    fails(shared);
  } catch (error) {
    console.log((error as Error).message, frames(error));
  }
}

literals();
objectsMadeElsewhere();
byValue();
nothing();
traces();
