// `list[position]` and `position in list` where the position is a whole number and no index: below zero, 2 ** 32 - 1 and above. Such a position is a name. Lists that have no such name, that have one,
// that had one, that inherit one, and what follows from each for a read and for `in`.
const lines: string[] = [];
const positions = [-1, -2, -2147483648, -2147483649, 4294967294, 4294967295, 4294967296, 9007199254740991, -9007199254740991];
function last(list: unknown[]): unknown { return list[list.length - 1]; }
function before(list: unknown[], index: number): unknown { return list[index - 1]; }
function at(list: unknown[], position: number): unknown { return list[position]; }
function has(list: unknown[], position: number): boolean { return position in list; }
function tell(label: string, make: () => unknown[]): void {
  let said = "";
  for (let turn = 0; turn < 3; turn++) {
    const list = make();
    said = String(last(list)) + " " + String(before(list, 0)) + " | " + positions.map(position => String(at(list, position)) + " " + has(list, position)).join(" | ");
  }
  lines.push(label + ": " + said);
}
function named(list: unknown[], name: number | string, value: unknown): unknown[] { (list as unknown as Record<string, unknown>)[name] = value; return list; }
tell("empty", () => []);
tell("whole numbers", () => [1, 2, 3]);
tell("fractions", () => [1.5, 2.5]);
tell("anything", () => ["a", {}, 3]);
tell("a hole", () => [1, , 3]);
tell("made by a built-in", () => "a,b".split(","));
tell("of a length alone", () => new Array(3));
tell("another name", () => named([1, 2], "label", "named"));
tell("-1 of its own", () => named([1, 2], -1, "own"));
tell("-1 of its own on an empty list", () => named([], -1, "own"));
tell("-1 of its own under a text", () => named([1.5], "-1", "own"));
tell("4294967295 of its own", () => named([1], 4294967295, "no index"));
tell("4294967296 of its own", () => named([1], 4294967296, "above"));
tell("-2147483649 of its own", () => named(["a"], -2147483649, "below"));
tell("-1 that is gone again", () => { const list = named([1, 2], -1, "own"); delete (list as unknown as Record<string, unknown>)[-1]; return list; });
tell("an accessor", () => Object.defineProperty([1], "-1", { get() { return "got " + this.length; }, configurable: true }));
tell("undefined of its own", () => named([1], -1, undefined));
tell("another prototype", () => Object.setPrototypeOf([1, 2], { "-1": "inherited", "4294967295": "inherited too" }));
tell("no prototype", () => Object.setPrototypeOf([1, 2], null));
class Stack extends Array<unknown> { get [-1]() { return "of the class"; } }
tell("of a class with such a name", () => Stack.from([1, 2]));
class Plain extends Array<unknown> {}
tell("of a class without", () => Plain.from([1, 2]));
tell("frozen", () => Object.freeze([1, 2]) as unknown[]);
tell("frozen with a name", () => Object.freeze(named([1, 2], -1, "own")) as unknown[]);
tell("sealed", () => Object.seal([1]));
tell("sparse", () => { const list: unknown[] = []; list[100000] = 1; return list; });
tell("sparse with a name", () => { const list: unknown[] = []; list[100000] = 1; return named(list, -1, "own"); });
tell("behind a proxy", () => new Proxy([1, 2], { get(target, key, receiver) { return typeof key === "string" && key[0] === "-" ? "trapped " + key : Reflect.get(target, key, receiver); }, has(target, key) { return key === "-2" || Reflect.has(target, key); } }));
const kept: unknown[] = [1, 2, 3];
let seen = 0;
for (let turn = 0; turn < 2000; turn++) {
  if (last([]) === undefined) seen++;
  if (before(kept, 0) === undefined) seen++;
  if (before([turn + 0.5], 0) === undefined) seen++;
  if (at(["a", turn], -3) === undefined) seen++;
  if (!has(kept, -1)) seen++;
  if (!has([turn], 4294967295)) seen++;
  if (turn === 1000) named(kept, -1, "late");
}
lines.push("rounds " + seen + " " + String(before(kept, 0)) + " " + has(kept, -1));
console.log(lines.join("\n"));
