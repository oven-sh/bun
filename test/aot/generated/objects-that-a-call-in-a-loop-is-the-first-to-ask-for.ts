// A declared function, a method, a built-in function and a prototype object are made when a program first asks for them, and each is the same object from then on.
// Each program here has a loop that gets a value from a call. On every third turn the value is such an object, and in most programs that call is the first to ask for it.
// The loop calls the value, compares it or looks it up.

type Thing = {
  /** Stands at the top of the file. */
  declares: string;
  /** The expression that asks for it. */
  asks: string;
  /** It takes a number and answers with a number. */
  isCalled?: true;
  /** The program also has a form with types. */
  hasTypes?: true;
  files?: Record<string, string>;
};

export const things: Record<string, Thing> = {
  "a declared function": {
    declares: "function thing(x«N»)«N» { return x * x; }",
    asks: "thing",
    isCalled: true,
    hasTypes: true,
  },
  "a method of a class": {
    declares: "class Holder { thing(x«N»)«N» { return x * x; } }",
    asks: "Holder.prototype.thing",
    isCalled: true,
    hasTypes: true,
  },
  "a static method": {
    declares: "class Holder { static thing(x«N»)«N» { return x * x; } }",
    asks: "Holder.thing",
    isCalled: true,
    hasTypes: true,
  },
  "a method of a literal": {
    declares: "const holder = { thing(x«N»)«N» { return x * x; } };",
    asks: "holder.thing",
    isCalled: true,
    hasTypes: true,
  },
  "a function in a field": {
    declares: "const holder = { thing: function (x«N»)«N» { return x * x; } };",
    asks: "holder.thing",
    isCalled: true,
    hasTypes: true,
  },
  "an arrow function in a field": {
    declares: "const holder = { thing: (x«N»)«N» => x * x };",
    asks: "holder.thing",
    isCalled: true,
    hasTypes: true,
  },
  "a function in a field of an instance": {
    declares: "class Holder { thing = (x«N»)«N» => x * x; }\nconst holder = new Holder();",
    asks: "holder.thing",
    isCalled: true,
    hasTypes: true,
  },
  "a getter of a class": {
    declares: "class Holder { get thing() { return 7; } }",
    asks: 'Object.getOwnPropertyDescriptor(Holder.prototype, "thing").get',
    isCalled: true,
  },
  "a function of another file": {
    declares: 'import { thing } from "./other";',
    asks: "thing",
    isCalled: true,
    hasTypes: true,
    files: { "other.«ext»": "export function thing(x«N»)«N» { return x * x; }\n" },
  },
  "a function that another function declares": {
    declares: "function outer() { function thing(x«N»)«N» { return x * x; } return thing; }",
    asks: "outer()",
    isCalled: true,
    hasTypes: true,
  },
  "Math.abs": { declares: "", asks: "Math.abs", isCalled: true, hasTypes: true },
  "Math.trunc": { declares: "", asks: "Math.trunc", isCalled: true, hasTypes: true },
  "Number": { declares: "", asks: "Number", isCalled: true, hasTypes: true },
  "parseInt": { declares: "", asks: "parseInt", isCalled: true },
  "an async function": { declares: "async function thing(x) { return x * x; }", asks: "thing" },
  "a generator function": { declares: "function* thing(x) { yield x * x; }", asks: "thing" },
  "a class": { declares: "class Thing { constructor(x) { this.x = x; } }", asks: "Thing" },
  "a method of Array.prototype": { declares: "", asks: "Array.prototype.indexOf" },
  "a function of the host": { declares: "", asks: "structuredClone" },
  "a function of process": { declares: "", asks: "process.cwd" },
  "the prototype object of a class": { declares: "class Holder { m() {} }", asks: "Holder.prototype" },
  "the prototype object of a function": { declares: "function Maker() {}", asks: "Maker.prototype" },
  "the prototype object of a built-in class": { declares: "", asks: "Map.prototype" },
  "a built-in object": { declares: "", asks: "Reflect" },
  "a well-known symbol": { declares: "", asks: "Symbol.asyncIterator" },
  "a registered symbol": { declares: "", asks: 'Symbol.for("thing")' },
  "a namespace": {
    declares: 'import * as thing from "./other";',
    asks: "thing",
    files: { "other.«ext»": "export const a = 1;\n" },
  },
  "the strings of a template": {
    declares: "function strings(s) { return s; }\nfunction thing() { return strings`a${1}b`; }",
    asks: "thing()",
  },
  "a BigInt": { declares: "", asks: "123456789012345678901234567890n" },
  "a text": { declares: "", asks: '"a text that nobody else in this file has written"' },
};

type Others = { declares: string; first: string; second: string; areCalled: boolean };

/** What the call hands back on the other two turns. */
export const others: Record<string, Others> = {
  "an arrow function and a closure": {
    declares: "function adder(n«N»)«F» { return x => x + n; }",
    first: "x => x * 2",
    second: "adder(i)",
    areCalled: true,
  },
  "two declared functions": {
    declares: "function double(x«N»)«N» { return x * 2; }\nfunction next(x«N»)«N» { return x + 1; }",
    first: "double",
    second: "next",
    areCalled: true,
  },
  "two built-in functions": { declares: "", first: "Math.floor", second: "Math.ceil", areCalled: true },
  "an object and a list": { declares: "const plain = { a: 1 };", first: "plain", second: "[i]", areCalled: false },
  "two built-in objects": { declares: "", first: "JSON", second: "Atomics", areCalled: false },
};

const choice = "i % 3 === 0 ? «first» : i % 3 === 1 ? «second» : «thing»";
const pick = `function pick(i«N»)«F» { return ${choice}; }`;

type Asker = {
  declares: string;
  /** Statements in the loop that declare `v`. They may add to `total`. */
  takes: string;
  awaits?: true;
  hasTypes?: true;
};

export const askers: Record<string, Asker> = {
  "a function": { declares: pick, takes: "const v = pick(i);", hasTypes: true },
  "a function that calls itself": {
    declares: `function pick(i«N», depth«N»)«F» { return depth > 0 ? pick(i, depth - 1) : ${choice}; }`,
    takes: "const v = pick(i, 2);",
    hasTypes: true,
  },
  "a function that ends in a call": {
    declares: `function choose(i«N»)«F» { return ${choice}; }\nfunction pick(i«N»)«F» { return choose(i); }`,
    takes: "const v = pick(i);",
    hasTypes: true,
  },
  "a method": {
    declares: `class Picker { pick(i«N»)«F» { return ${choice}; } }\nconst picker = new Picker();`,
    takes: "const v = picker.pick(i);",
    hasTypes: true,
  },
  "a static method": {
    declares: `class Picker { static pick(i«N»)«F» { return ${choice}; } }`,
    takes: "const v = Picker.pick(i);",
    hasTypes: true,
  },
  "a getter": {
    declares: `const picker = { turn: 0, get picked()«F» { const i = this.turn; return ${choice}; } };`,
    takes: "picker.turn = i;\n  const v = picker.picked;",
    hasTypes: true,
  },
  "a setter": {
    declares: `const picker = { kept: undefined, set turn(i) { this.kept = ${choice}; } };`,
    takes: "picker.turn = i;\n  const v = picker.kept;",
  },
  "a constructor": {
    declares: `class Picked { value«F»; constructor(i«N») { this.value = ${choice}; } }`,
    takes: "const v = new Picked(i).value;",
    hasTypes: true,
  },
  "a callback of map": { declares: pick, takes: "const v = [i].map(pick)[0];", hasTypes: true },
  "a callback of forEach": { declares: "", takes: `let v;\n  [i].forEach(i => { v = ${choice}; });` },
  "a generator": {
    declares: `function* picks()«G» { for (let i = 0; ; i++) yield ${choice}; }\nconst walk = picks();`,
    takes: "const v = walk.next().value;",
    hasTypes: true,
  },
  "a closure": {
    declares: `function makePick(base«N») { return (turn«N»)«F» => { const i = turn + base; return ${choice}; }; }\nconst pick = makePick(0);`,
    takes: "const v = pick(i);",
    hasTypes: true,
  },
  "a function that throws it": {
    declares: `function pick(i) { throw ${choice}; }`,
    takes: "let v;\n  try { pick(i); } catch (thrown) { v = thrown; }",
  },
  "an async function": {
    declares: `async function pick(i«N»)«P» { return ${choice}; }`,
    takes: "const v = await pick(i);",
    awaits: true,
    hasTypes: true,
  },
  "Reflect.apply": { declares: pick, takes: "const v«F» = Reflect.apply(pick, undefined, [i]);", hasTypes: true },
  "call": { declares: pick, takes: "const v = pick.call(undefined, i);", hasTypes: true },
  "apply": { declares: pick, takes: "const v = pick.apply(undefined, [i]);", hasTypes: true },
  "a bound function": {
    declares: `${pick}\nconst bound = pick.bind(undefined);`,
    takes: "const v = bound(i);",
    hasTypes: true,
  },
  "a table of functions": {
    declares: "const table = [(i«N»)«F» => «first», (i«N»)«F» => «second», (i«N»)«F» => «thing»];",
    takes: "const v = table[i % 3](i);",
    hasTypes: true,
  },
  "a function that stores it in a variable": {
    declares: `let kept;\nfunction pick(i) { kept = ${choice}; }`,
    takes: "pick(i);\n  const v = kept;",
  },
  "a function that stores it in a list": {
    declares: `const kept = [];\nfunction pick(i) { kept[0] = ${choice}; }`,
    takes: "pick(i);\n  const v = kept[0];",
  },
  "a function that stores it in a field": {
    declares: `const keeper = { kept: undefined };\nfunction pick(i) { keeper.kept = ${choice}; }`,
    takes: "pick(i);\n  const v = keeper.kept;",
  },
  "a function that hands back an object with it": {
    declares: `function pick(i«N») { return { value: ${choice} }; }`,
    takes: "const v = pick(i).value;",
  },
  "a function that hands back a list with it": {
    declares: `function pick(i«N») { return [${choice}]; }`,
    takes: "const [v] = pick(i);",
  },
  "the default of a parameter": {
    declares: `function pick(i, value = ${choice}) { return value; }`,
    takes: "const v = pick(i);",
  },
  "a conversion to a number": {
    declares: `const picker = { turn: 0, kept: undefined, valueOf() { const i = this.turn; this.kept = ${choice}; return 0; } };`,
    takes: "picker.turn = i;\n  total += +picker;\n  const v = picker.kept;",
  },
  "a trap of a proxy": {
    declares: `const picker = new Proxy({}, { get(target, key) { const i = Number(key); return ${choice}; } });`,
    takes: "const v = picker[i];",
  },
};

type Question = {
  declares?: string;
  /** Statements in the loop. They add to `total` or to `names`. */
  asks: string;
  calls?: true;
  hasTypes?: true;
};

export const questions: Record<string, Question> = {
  "it is called": { asks: "total += v(i + 1.5);", calls: true, hasTypes: true },
  "a helper calls it twice": {
    declares: "function twice(f«F», x«N»)«N» { return f(f(x)); }",
    asks: "total += twice(v, i + 1.5);",
    calls: true,
    hasTypes: true,
  },
  "call calls it": { asks: "total += v.call(undefined, i + 1.5);", calls: true, hasTypes: true },
  "map calls it": { asks: "total += [i + 1.5].map(v)[0];", calls: true, hasTypes: true },
  "it is called and compared": {
    asks: "total += v(i + 1.5) + (v === «thing» ? 100 : 1);",
    calls: true,
    hasTypes: true,
  },
  "it is compared": { asks: "total += v === «thing» ? 100 : 1;", hasTypes: true },
  "a helper compares it": {
    declares: "function isThing(value«F») { return value === «thing»; }",
    asks: "total += isThing(v) ? 100 : 1;",
    hasTypes: true,
  },
  "a switch finds it": {
    asks: "switch (v) { case «thing»: total += 100; break; default: total += 1; }",
    hasTypes: true,
  },
  "a list finds it": { asks: "total += ([«thing»]«Fs»).indexOf(v) + 2;", hasTypes: true },
  "it is compared with the one of three turns ago": {
    declares: "let last;",
    asks: "if (i % 3 === 2) { total += v === last ? 100 : 1; last = v; }",
  },
  "a map finds it": {
    declares: "const seen = new Map();",
    asks: "total += seen.get(v) ?? 0;\n  seen.set(v, i + 1.5);",
  },
  "its name is read": { asks: 'names += typeof v + " " + String(v?.name) + ",";' },
};

const body = "{\n  «takes»\n  «question»\n}";

/** «async» and «await» stand where the loop awaits. */
export const places: Record<string, string> = {
  "at the top of the file": `let total = 0;\nlet names = "";\nfor (let i = 0; i < 9; i++) ${body}\nconsole.log(total, names);`,
  "in a function that is called twice": `«async»function run() {\nlet total = 0;\nlet names = "";\nfor (let i = 0; i < 9; i++) ${body}\nreturn total + " " + names;\n}\nconsole.log(«await»run());\nconsole.log(«await»run());`,
  "in the inner of two loops": `let total = 0;\nlet names = "";\nfor (let j = 0; j < 2; j++)\nfor (let i = 0; i < 9; i++) ${body}\nconsole.log(total, names);`,
  "in a walk over a list": `let total = 0;\nlet names = "";\nfor (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8]) ${body}\nconsole.log(total, names);`,
  "in a while loop": `let total = 0;\nlet names = "";\nlet i = 0;\nwhile (i < 9) {\n${body}\ni++;\n}\nconsole.log(total, names);`,
};

/** What else the program does with the object, behind the loop. */
export const afterwards: Record<string, string> = {
  "nothing else": "",
  "it is compared with itself": "console.log(«thing» === «thing», typeof «thing»);",
  "its name is read": "console.log(String(Object(«thing»).name), String(Object(«thing»).length));",
  "a list holds it": "console.log([«thing», «thing»].lastIndexOf(«thing»));",
  "it gets a property": 'console.log(Reflect.set(Object(«thing»), "extra", 1), Object(«thing»).extra);',
};

export const hasTypedForm = (thing: string, asker: string, question: string) =>
  !!things[thing].hasTypes && !!askers[asker].hasTypes && !!questions[question].hasTypes;

export const fits = (thing: string, question: string) => !!things[thing].isCalled || !questions[question].calls;

export function program(
  thing: string,
  other: string,
  asker: string,
  question: string,
  place: string,
  afterward: string,
  isTyped: boolean,
) {
  const { declares, asks, files = {} } = things[thing];
  const written = (text: string) =>
    text
      .replaceAll("«thing»", asks)
      .replaceAll("«first»", others[other].first)
      .replaceAll("«second»", others[other].second)
      .replaceAll("«async»", askers[asker].awaits ? "async " : "")
      .replaceAll("«await»", askers[asker].awaits ? "await " : "")
      .replaceAll("«ext»", isTyped ? "ts" : "js")
      .replaceAll("«N»", isTyped ? ": number" : "")
      .replaceAll("«Fs»", isTyped ? " as F[]" : "")
      .replaceAll("«F»", isTyped ? ": F" : "")
      .replaceAll("«G»", isTyped ? ": Generator<F, never>" : "")
      .replaceAll("«P»", isTyped ? ": Promise<F>" : "");
  const text = [
    declares,
    isTyped ? "type F = (x: number) => number;" : "",
    others[other].declares,
    askers[asker].declares,
    questions[question].declares ?? "",
    places[place].replaceAll("«takes»", askers[asker].takes).replaceAll("«question»", questions[question].asks),
    afterwards[afterward],
  ]
    .filter(part => part)
    .join("\n");
  return {
    file: isTyped ? "main.ts" : "main.js",
    text: written(text) + "\n",
    files: Object.fromEntries(Object.entries(files).map(([name, content]) => [written(name), written(content)])),
  };
}

export type Listed = { name: string; flags: string[]; make: () => ReturnType<typeof program> };

/**
 * Every thing beside all others from every asker, every thing under every question in every place, every asker under every question, and every thing with everything that follows the loop.
 * Each as it is and in a build that counts the program as very large.
 */
export function listed(): Listed[] {
  const cases = new Map<string, [string, string, string, string, string, string]>();
  const add = (thing: string, other: string, asker: string, question: string, place: string, afterward: string) => {
    if (fits(thing, question) && others[other].areCalled === !!things[thing].isCalled)
      cases.set(`${thing} or ${other} come from ${asker}, ${place}: ${question}; behind the loop ${afterward}`, [
        thing,
        other,
        asker,
        question,
        place,
        afterward,
      ]);
  };
  const usual = (thing: string) =>
    things[thing].isCalled ? "an arrow function and a closure" : "an object and a list";
  const telling = (thing: string) => (things[thing].isCalled ? "a helper calls it twice" : "a switch finds it");
  for (const thing of Object.keys(things))
    for (const other of Object.keys(others))
      for (const asker of Object.keys(askers))
        add(thing, other, asker, telling(thing), "at the top of the file", "it is compared with itself");
  for (const thing of Object.keys(things))
    for (const question of Object.keys(questions))
      for (const place of Object.keys(places))
        add(thing, usual(thing), "a function", question, place, "it is compared with itself");
  for (const asker of Object.keys(askers))
    for (const question of Object.keys(questions))
      for (const thing of ["a declared function", "a method of a class", "Math.abs"])
        add(thing, "two built-in functions", asker, question, "in a function that is called twice", "its name is read");
  for (const thing of Object.keys(things))
    for (const other of Object.keys(others))
      for (const question of [telling(thing), "it is compared with the one of three turns ago"])
        for (const afterward of Object.keys(afterwards))
          add(thing, other, "a function", question, "at the top of the file", afterward);

  const all: Listed[] = [];
  for (const [name, [thing, other, asker, question, place, afterward]] of cases)
    for (const isTyped of hasTypedForm(thing, asker, question) ? [false, true] : [false])
      for (const isVeryLarge of [false, true])
        all.push({
          name: `${name}${isTyped ? ", with types" : ""}${isVeryLarge ? ", in a build that counts the program as very large" : ""}`,
          flags: isVeryLarge ? ["--aot-limit=MaxWarmCodeValues:1"] : [],
          make: () => program(thing, other, asker, question, place, afterward, isTyped),
        });
  return all;
}
