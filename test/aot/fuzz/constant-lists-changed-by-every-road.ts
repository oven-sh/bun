// Lists of constants at the top of a module, asked by small functions what they hold, then changed by one road each, then asked again: what a compiler concludes about a list that is written out in full holds only as long as nothing changes the list, by whatever road.
//
//   lists   two to five strings, whole numbers, fractions, booleans, null and undefined, or a mix; `const` or `let`; exported or not; some stand in a second variable, a field or another list too
//   asked   includes, indexOf, lastIndexOf, at, join, length, an element by a constant index, `in`, a for-of, a spread, a pattern, some, find, every
//   roads   a store by index, by a computed key, through Reflect, Object.assign, defineProperty and defineProperties; methods of arrays called by name, by a computed name, by call, apply, bind, Reflect.apply and
//           Function.prototype.call.call; patterns and loops whose target is an element; a Proxy; text that is evaluated; `arguments`, a rest parameter, `this`, a setter, a catch, a generator, a reviver, a comparator;
//           a holder that the list was put into; roads that change nothing stand among them
//
// Each line names the road and prints the answers ahead of the change and behind it.
import type { Random } from "./random";

const elements = {
  strings: ['"a"', '"b"', '"c"', '"d"', '""', '"z"', '"length"', '"0"'],
  wholeNumbers: ["0", "1", "2", "3", "-1", "7", "2147483647", "-2147483648"],
  fractions: ["0.5", "1.5", "-0", "NaN", "1e21", "4294967296"],
  others: ["true", "false", "null", "undefined"],
};

// `L` is the list, `V` a value that the list does not hold when it is made.
const roads: [string, string][] = [
  ["a store by index", "L[0] = V;"],
  ["a store behind the end", "L[L.length] = V;"],
  ["a store by a computed key", "const key = String(0); L[key as unknown as number] = V;"],
  ["a length", "L.length = 1;"],
  ["a delete", "delete L[0];"],
  ["Reflect.set", "Reflect.set(L, 0, V);"],
  ["Reflect.set of the length", 'Reflect.set(L, "length", 0); Reflect.set(L, 0, V);'],
  ["Reflect.deleteProperty", "Reflect.deleteProperty(L, 0);"],
  ["Object.assign", "Object.assign(L, { 0: V });"],
  ["Object.defineProperty", "Object.defineProperty(L, 0, { value: V });"],
  ["Object.defineProperties", "Object.defineProperties(L, { 0: { value: V } });"],
  ["Reflect.defineProperty", "Reflect.defineProperty(L, 0, { value: V, writable: true, enumerable: true, configurable: true });"],
  ["push", "L.push(V);"],
  ["unshift", "L.unshift(V);"],
  ["pop", "L.pop();"],
  ["shift", "L.shift();"],
  ["fill", "L.fill(V);"],
  ["splice", "L.splice(0, 1, V);"],
  ["reverse", "L.reverse();"],
  ["sort", "L.sort((a, b) => (String(a) < String(b) ? 1 : -1));"],
  ["copyWithin", "L.copyWithin(0, 1);"],
  ["a method by a computed name", '(L as any)["un" + "shift"](V);'],
  ["push by call", "Array.prototype.push.call(L, V);"],
  ["fill by apply", "Array.prototype.fill.apply(L, [V]);"],
  ["push by bind", "Array.prototype.push.bind(L)(V);"],
  ["push by Reflect.apply", "Reflect.apply(Array.prototype.push, L, [V]);"],
  ["push by call of call", "Function.prototype.call.call(Array.prototype.push, L, V);"],
  ["reverse off the prototype", "Object.getPrototypeOf(L).reverse.call(L);"],
  ["a list pattern", "[L[0]] = [V];"],
  ["an object pattern", "({ x: L[0] } = { x: V });"],
  ["the target of a for-of", "for (L[0] of [V]);"],
  ["the target of a for-in", 'for ((L as any)[0] in { z: 1 });'],
  ["a Proxy", "new Proxy(L, {})[0] = V;"],
  ["new Function", 'new Function("list", "value", "list[0] = value")(L, V);'],
  ["an indirect eval", '(globalThis as any).handed = [L, V]; (0, eval)("handed[0][0] = handed[1]");'],
  ["a field of a holder", "const holder = { list: L }; holder.list[0] = V;"],
  ["an element of a holder", "const holder = [L]; holder[0][0] = V;"],
  ["a Map", 'new Map([["k", L]]).get("k")![0] = V;'],
  ["arguments", "(function (..._: unknown[]) { (arguments[0] as any)[0] = arguments[1]; })(L, V);"],
  ["a rest parameter", "((...rest: any[]) => { rest[0][0] = rest[1]; })(L, V);"],
  ["a spread call", "((list: any, value: any) => { list[0] = value; })(...[L, V]);"],
  ["this", "(function (this: any) { this[0] = V; }).call(L);"],
  ["a setter", "const holder = { set list(list: any) { list[0] = V; } }; holder.list = L;"],
  ["a catch", "try { throw L; } catch (thrown: any) { thrown[0] = V; }"],
  ["a generator", "(function* (list: any) { list[0] = V; })(L).next();"],
  ["a reviver", 'JSON.parse("[1]", () => { L[0] = V; return 1; });'],
  ["a comparator of another list", "[2, 1].sort(() => { L[0] = V; return 0; });"],
  ["a callback of its own method", "L.forEach((_, index, list) => { if (!index) list[0] = V; });"],
  ["a getter that a copy runs", "({ ...{ get x() { L[0] = V; return 1; } } });"],
  ["a conversion", "`${{ toString() { L[0] = V; return \"\"; } }}`;"],
  ["an own iterator", "(L as any)[Symbol.iterator] = function* () { yield V; };"],
  ["toSpliced, which changes nothing", "L.toSpliced(0, 1, V);"],
  ["with, which changes nothing", "L.with(0, V);"],
  ["slice, which changes nothing", "L.slice().fill(V);"],
  ["freeze, which changes nothing", "Object.freeze(L);"],
];

// `X` is a value to ask for.
const questions = [
  "L.includes(X)",
  "L.indexOf(X)",
  "L.lastIndexOf(X)",
  "L.at(0)",
  "L.at(-1)",
  "L[0]",
  "L[1]",
  "L.length",
  'L.join("|")',
  "0 in L",
  "[...L].length",
  "L.some(each => Object.is(each, X))",
  "L.every(each => !Object.is(each, X))",
  "L.find(each => Object.is(each, X))",
  "(() => { let text = \"\"; for (const each of L) text += String(each) + \",\"; return text; })()",
  "(() => { const [first, second] = L; return String(first) + String(second); })()",
];

export function generate(random: Random): string {
  const lines = [
    `function show(value: unknown): string {`,
    `  return Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value);`,
    `}`,
  ];
  const chosen = random.shuffled(roads).slice(0, random.between(8, 20));
  chosen.forEach(([name, road], index) => {
    const kind = random.pick(["strings", "strings", "wholeNumbers", "wholeNumbers", "fractions", "mixed"] as const);
    const pool = kind === "mixed" ? [...elements.strings, ...elements.wholeNumbers, ...elements.fractions, ...elements.others] : elements[kind];
    const drawn = random.shuffled(pool);
    const held = drawn.slice(0, random.between(2, 5));
    const stranger = drawn[5];
    const list = `list${index}`;
    const asked = random.shuffled(questions).slice(0, random.between(2, 5));
    lines.push(`${random.chance(0.2) ? "export " : ""}${random.chance(0.2) ? "let" : "const"} ${list}: any[] = [${held.join(", ")}];`);
    if (random.chance(0.2)) lines.push(`const alsoNamed${index} = ${random.pick([list, `{ list: ${list} }`, `[${list}]`])};`);
    lines.push(`function ask${index}(): string {`);
    lines.push(`  return [${asked.flatMap(question => [held[0], stranger].map(value => `show(${question.replaceAll("L", list).replaceAll("X", value)})`)).join(", ")}].join(" ");`);
    lines.push(`}`);
    lines.push(`function change${index}(): void {`);
    lines.push(`  ${road.replaceAll(/\bL\b/g, list).replaceAll(/\bV\b/g, stranger)}`);
    lines.push(`}`);
    lines.push(`{`);
    lines.push(`  let before = "";`);
    lines.push(`  for (let turn = 0; turn < ${random.pick([1, 3, 200])}; turn++) before = ask${index}();`);
    lines.push(`  let thrown = "";`);
    lines.push(`  try { change${index}(); } catch (error) { thrown = " THROWS " + (error as Error).constructor.name; }`);
    lines.push(`  console.log(${JSON.stringify(name)} + ": " + before + " > " + ask${index}() + thrown);`);
    lines.push(`}`);
  });
  return lines.join("\n") + "\n";
}
