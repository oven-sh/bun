// Small programs in which a loop of the library that calls a member by its name (`next`, `return`, `then`, `toString`, `valueOf`, `toJSON`, a callback) runs at the top of a file on built-in objects
// alone. Below that line a `let`, `const` or `class` is declared, and below the declaration stands an object of the program with a member of the same name, which reads the variable and stores to it.
// The first run never comes near the variable. Nothing is caught and nothing is printed on the way: what the variable holds is printed at the end, or not at all.
//
//   the loop         iterator helpers (`some`, `every`, `find`, `forEach`, `reduce`, `toArray`, `map`, `filter`, `take`, `drop`, `flatMap`), `Array.from`, a spread, a pattern, `for of`, `new Set`, `new Map`,
//                    `Object.fromEntries`, `Promise.all`, `yield*`; a template, `String`, `+`, `join`; `JSON.stringify`; `await`
//   the variable     a text that is appended to, a number that is counted up, a list that is pushed to, an object, a class with a static member; `let`, `const`, `var`
//   who touches it   the member itself, or a function that the member calls
//   the object       with `next` alone, with `return` too, with `throw` too; made by a function, a class, a literal at the top of the file
//   it is used       by `for of`, a spread, a pattern that ends early, `Array.from`, an iterator helper of another name, `yield*`; a template; `JSON.stringify`; `await`
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const typed = random.chance(0.5);
  const any = typed ? ": any" : "";
  const protocol = random.weighted([
    [7, "iterator"],
    [1, "text"],
    [1, "json"],
    [1, "then"],
  ] as const);
  const kind = random.weighted([
    [5, "text"],
    [2, "number"],
    [2, "list"],
    [1, "object"],
    [1, "class"],
  ] as const);
  const word =
    kind === "list" || kind === "object"
      ? random.pick(["let", "const"])
      : kind === "class"
        ? "class"
        : random.pick(["let", "let", "let", "var"]);
  const declaration = {
    text: `${word} L = ${random.pick(['""', '""', '"-"', "String()"])};`,
    number: `${word} L = ${random.pick(["0", "0", "0.5", "1"])};`,
    list: `${word} L${typed ? ": any[]" : ""} = [];`,
    object: `${word} L${any} = { n: ${random.pick(['""', "0"])} };`,
    class: `class L {\nstatic n${any} = ${random.pick(['""', "0"])};\n}`,
  }[kind]!;
  const touch = (what: string) =>
    ({
      text: random.pick([`L += ${what};`, `L += ${what};`, `L = L + ${what};`, "L = `${L}${" + what + "}`;"]),
      number: random.pick(["L++;", "L += 1;", "L = L + 1;", `L += ${what}.length;`]),
      list: `L.push(${what});`,
      object: `L.n += ${what};`,
      class: `L.n += ${what};`,
    })[kind]!;
  const through = random.chance(0.6);
  const log = through ? `function log(s${typed ? ": string" : ""})${typed ? ": void" : ""} {\n${touch("s")}\n}` : "";
  const does = (what: string) => (through ? `log(${what});` : touch(what));
  const above = {
    iterator: random.pick([
      "console.log([1].values().some(Boolean));",
      "console.log([1].values().some(Boolean));",
      "console.log([1].values().some(Boolean));",
      "console.log([1].values().every(Boolean));",
      "console.log([1].values().find(Boolean));",
      "[1].values().forEach(String);",
      "console.log([1, 2].values().reduce(Math.max));",
      "console.log([1].values().toArray().length);",
      "console.log([1].values().map(String).toArray().length);",
      "console.log([1].values().filter(Boolean).toArray().length);",
      "console.log([1].values().take(1).toArray().length);",
      "console.log([1].values().drop(0).toArray().length);",
      "console.log([1].values().flatMap(x => [x]).toArray().length);",
      "console.log(Array.from([1].values()).length);",
      "console.log([...[1].values()].length);",
      "console.log(new Set([1].values()).size);",
      `console.log(new Map(${typed ? "([[1, 2]] as [number, number][])" : "[[1, 2]]"}.values()).size);`,
      'console.log(Object.fromEntries([["a", 1]].values()).a);',
      "console.log(Math.max(...[1].values()));",
      "for (const x of [1].values()) console.log(x);",
      "{\nconst [first] = [1].values();\nconsole.log(first);\n}",
      "console.log([1].keys().some(Boolean), new Set([1]).values().some(Boolean));",
      'console.log(new Map([[1, 2]]).keys().some(Boolean), "ab"[Symbol.iterator]().some(Boolean));',
      "console.log((await Promise.all([1].values())).length);",
      "console.log([...(function* () {\nyield* [1].values();\n})()].length);",
    ]),
    text: random.pick([
      "console.log(`${[1]}`);",
      "console.log(String({}));",
      'console.log([1] + "");',
      "console.log([[1], {}].join());",
      "console.log(`${new Date(0).getTime()}`);",
    ]),
    json: random.pick([
      "console.log(JSON.stringify([1]));",
      "console.log(JSON.stringify({ a: new Date(0) }));",
      'console.log(JSON.stringify({ a: [{ b: "c" }] }));',
    ]),
    then: random.pick([
      "console.log(await Promise.resolve(1));",
      "console.log(await 1);",
      "console.log(await Promise.all([1, Promise.resolve(2)]));",
      "console.log(await (async () => 1)());",
    ]),
  }[protocol]!;
  const turns = random.pick([1, 2, 2, 3]);
  const more = random.pick(["next", "return", "return", "return", "throw"]);
  const members = [
    `[Symbol.iterator]()${any} {\nreturn this;\n}`,
    `next()${any} {\n${does('"n"')}\nconst j = i++;\nreturn { done: j >= ${turns}, value: j };\n}`,
    more !== "next" ? `return()${any} {\n${random.pick(["", "", does('"r"')])}\nreturn {};\n}` : "",
    more === "throw" ? `throw()${any} {\nreturn {};\n}` : "",
  ].filter(Boolean);
  const maker = {
    iterator: random.pick([
      `function mk()${any} {\nlet i = 0;\nreturn {\n${members.join(",\n")},\n};\n}`,
      `function mk()${any} {\nlet i = 0;\nreturn {\n${members.join(",\n")},\n};\n}`,
      `const mk = ()${any} => {\nlet i = 0;\nreturn {\n${members.join(",\n")},\n};\n};`,
      `let i = 0;\nclass Steps {\n${members.join("\n")}\n}\nconst mk = ()${any} => ((i = 0), new Steps());`,
      `let i = 0;\nconst steps${any} = {\n${members.join(",\n")},\n};\nconst mk = ()${any} => ((i = 0), steps);`,
    ]),
    text: `const mk = ()${any} => ({\n${random.pick(["toString", "toString", "valueOf", "[Symbol.toPrimitive]"])}()${any} {\n${does('"t"')}\nreturn "x";\n},\n});`,
    json: `const mk = ()${any} => ({\ntoJSON()${any} {\n${does('"j"')}\nreturn 1;\n},\n});`,
    then: `const mk = ()${any} => ({\nthen(resolve${any})${any} {\n${does('"t"')}\nresolve(1);\n},\n});`,
  }[protocol]!;
  const use = {
    iterator: random.pick([
      `for (const v of mk()) ${does('"b"')}`,
      `for (const v of mk()) ${does('"b"')}`,
      `for (const v of mk()) ${does('"b"')}`,
      `for (const v of mk()) {\n${does('"b"')}\nbreak;\n}`,
      "console.log([...mk()].length);",
      "{\nconst [first] = mk();\nconsole.log(first);\n}",
      "console.log(Array.from(mk()).length);",
      "console.log(new Set(mk()).size);",
      "console.log(Iterator.from(mk()).toArray().length);",
      `console.log(Iterator.from(mk()).every((x${any}) => x < 1));`,
      "console.log([...(function* () {\nyield* mk();\n})()].length);",
      "console.log(Math.max(...mk()));",
    ]),
    text: random.pick([
      "console.log(`${mk()}`);",
      'console.log(mk() + "");',
      "console.log([mk(), mk()].join());",
      "console.log(String(mk()));",
    ]),
    json: random.pick(["console.log(JSON.stringify(mk()));", "console.log(JSON.stringify([mk(), { a: mk() }]));"]),
    then: random.pick([
      "console.log(await mk());",
      "console.log(await Promise.all([mk(), mk()]));",
      "console.log(await Promise.resolve(mk()));",
    ]),
  }[protocol]!;
  const end = random.pick([
    "",
    "",
    kind === "class" || kind === "object"
      ? "console.log(L.n);"
      : kind === "list"
        ? "console.log(L.join());"
        : "console.log(L);",
  ]);
  // Where the pieces stand: the run on built-in objects is always above the declaration.
  const text = [
    above,
    ...(random.chance(0.2)
      ? [maker, declaration, log]
      : random.chance(0.3)
        ? [declaration, maker, log]
        : [declaration, log, maker]),
    use,
    random.chance(0.15) ? use : "",
    end,
  ]
    .filter(Boolean)
    .join("\n");
  const waits = /\bawait\b/.test(text);
  return {
    file: typed ? "main.ts" : waits ? "main.mjs" : random.pick(["main.js", "main.mjs", "main.cjs"]),
    text: text + "\n" + (typed ? "export {};\n" : ""),
  };
}
