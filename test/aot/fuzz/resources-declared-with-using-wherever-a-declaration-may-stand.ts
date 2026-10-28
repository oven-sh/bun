// Resources declared with `using` and `await using`, and when and how they are disposed of.
//
//   resources   an object with a method, one that throws, `null`, `undefined`, what has no method or one that cannot be called, a getter that tells when it is read, a method of the prototype,
//               a function, a method replaced behind the declaration, a `DisposableStack`; for `await using` a method that waits, rejects, throws, answers with a number or with a thenable,
//               an object with both methods, one with the synchronous method alone
//   declared    one or several in a declaration, several declarations in a block, both kinds in one block, with a written type, behind `as`, `satisfies` and `!`
//   places      a block, the body of a function, an arrow function, a method, a getter, a constructor, a static block, a generator, `try`, `catch` and `finally`, the head of `for`, `for .. of` and
//               `for await`, the body of a loop, a clause of `switch`, a labeled block, blocks in blocks, the top of the file
//   left by     the end, `return`, `throw`, `break`, `continue`, a `yield` nobody comes back to
//   read        the order of everything; what is thrown, with every `SuppressedError` taken apart; what a `return` answers with where a resource changes the variable; how many jobs pass
import type { Random } from "./random";

const head = `const lines: string[] = [];
function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (depth > 3) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).map(key => key + ":" + show((value as any)[key], depth + 1)).join(",") + "}";
  return String(value);
}
function describe(error: unknown, depth = 0): string {
  if (error instanceof SuppressedError && depth < 6) return "Suppressed(" + describe(error.error, depth + 1) + " over " + describe(error.suppressed, depth + 1) + ")";
  if (error instanceof Error) return error.constructor.name + (error.constructor === Error ? " " + error.message : "");
  return show(error);
}
function note(...parts: unknown[]): void {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function tell<T>(label: string, value: T): T {
  note("runs", label);
  return value;
}
let count = 0;
let jobs = 0;
let counts = false;
function passes(): void {
  jobs++;
  if (counts && jobs < 60) Promise.resolve().then(passes);
}
function made(name: string, kind: string): any {
  note("makes", name, kind);
  const over = () => {
    count++;
    note("disposes of", name);
  };
  switch (kind) {
    case "fine":
      return { name, [Symbol.dispose]() { over(); note("this", this.name); } };
    case "throws":
      return { name, [Symbol.dispose]() { over(); throw new Error(name); } };
    case "throws undefined":
      return { name, [Symbol.dispose]() { over(); throw undefined; } };
    case "null":
      return null;
    case "undefined":
      return undefined;
    case "bare":
      return { name };
    case "number":
      return 1;
    case "not callable":
      return { name, [Symbol.dispose]: 1, [Symbol.asyncDispose]: 1 };
    case "null method":
      return { name, [Symbol.dispose]: null, [Symbol.asyncDispose]: null };
    case "getter":
      return { name, get [Symbol.dispose]() { note("reads the method of", name); return over; } };
    case "inherited":
      return new (class Resource { name = name; [Symbol.dispose]() { over(); note("this", this.name); } })();
    case "function":
      return Object.assign(function resource() {}, { [Symbol.dispose]() { over(); note("this", typeof this); } });
    case "answers":
      return { name, [Symbol.dispose]() { over(); return Promise.reject(new Error("nobody waits for " + name)).catch(() => {}); } };
    case "stack": {
      const stack = new DisposableStack();
      stack.defer(() => note("deferred first by", name));
      stack.use(made(name + " in the stack", "fine"));
      stack.adopt(name, value => note("adopted", value));
      return stack;
    }
    case "waits":
      return { name, async [Symbol.asyncDispose]() { note("begins to dispose of", name); await null; over(); } };
    case "rejects":
      return { name, async [Symbol.asyncDispose]() { over(); throw new Error(name); } };
    case "throws at once":
      return { name, [Symbol.asyncDispose]() { over(); throw new Error(name); } };
    case "answers with a number":
      return { name, [Symbol.asyncDispose]() { over(); return 5; } };
    case "answers with a thenable":
      return { name, [Symbol.asyncDispose]() { over(); return { then(done: () => void) { note("then of", name); done(); } }; } };
    case "both":
      return { name, [Symbol.dispose]() { note("the synchronous method of", name); }, async [Symbol.asyncDispose]() { over(); } };
    case "asynchronous getter":
      return { name, get [Symbol.asyncDispose]() { note("reads the asynchronous method of", name); return undefined; }, get [Symbol.dispose]() { note("reads the method of", name); return over; } };
    case "synchronous promise":
      return { name, [Symbol.dispose]() { over(); return new Promise(() => {}); } };
    case "asynchronous stack": {
      const stack = new AsyncDisposableStack();
      stack.defer(async () => { await null; note("deferred by", name); });
      stack.use(made(name + " in the stack", "waits"));
      return stack;
    }
  }
  throw new Error("no such kind");
}
`;

const both = [
  "fine",
  "fine",
  "fine",
  "throws",
  "throws",
  "throws undefined",
  "null",
  "undefined",
  "bare",
  "number",
  "not callable",
  "null method",
  "getter",
  "inherited",
  "function",
  "answers",
  "stack",
];
const waited = [
  "waits",
  "waits",
  "rejects",
  "throws at once",
  "answers with a number",
  "answers with a thenable",
  "both",
  "asynchronous getter",
  "synchronous promise",
  "asynchronous stack",
];

export function generate(random: Random): string {
  const rows: string[] = [];
  const scenes = random.between(4, 9);
  let resources = 0;

  for (let id = 0; id < scenes; id++) {
    const isAsync = random.chance(0.5);
    const resource = (waits: boolean) => {
      const name = `r${resources++}`;
      const value = `made("${name}", "${random.pick(waits && random.chance(0.7) ? waited : both)}")`;
      return [
        name,
        random.weighted([
          [6, value],
          [1, `${value} as Disposable`],
          [1, `${value} satisfies any`],
          [1, `${value}!`],
          [1, `(${value})`],
        ]),
      ];
    };
    const names: string[] = [];
    /** One declaration, and now and then a statement about what it declares. */
    const declaration = (): string => {
      const waits = isAsync && random.chance(0.6);
      const declared: string[] = [];
      const found: string[] = [];
      for (
        let left = random.weighted([
          [5, 1],
          [2, 2],
          [1, 3],
        ]);
        left > 0;
        left--
      ) {
        const [name, value] = resource(waits);
        found.push(name);
        declared.push(
          `${name}${random.chance(0.15) ? (waits ? ": AsyncDisposable | Disposable | null | undefined" : ": Disposable | null | undefined") : ""} = ${value}`,
        );
      }
      names.push(...found);
      const behind = random.weighted([
        [5, ""],
        [1, `\nif (${found[0]}) (${found[0]} as any)[Symbol.dispose] = () => note("the method put in later");`],
        [1, `\nlate.push(() => ${found[0]});`],
        [1, `\nnote("holds", typeof ${found[0]});`],
      ]);
      return `${waits ? "await using" : "using"} ${declared.join(", ")};${behind}`;
    };
    const declarations = () =>
      Array.from(
        {
          length: random.weighted([
            [4, 1],
            [2, 2],
            [1, 3],
          ]),
        },
        declaration,
      ).join("\n");
    const leaves = (...more: string[]) =>
      random.pick([
        "",
        "",
        `return tell("what is returned", count);`,
        `throw new Error("thrown in the body");`,
        `if (count >= 0) throw new Error("thrown in the body");`,
        `if (count >= 0) return count;`,
        ...more,
      ]);
    const wait = () => (isAsync && random.chance(0.4) ? `await null;\nnote("waited");\n` : "");
    const a = isAsync ? "async " : "";
    const w = isAsync ? "await " : "";

    const place = random.pick([
      "block",
      "block",
      "body",
      "arrow",
      "method",
      "getter",
      "constructor",
      "static block",
      "generator",
      "generator",
      "try",
      "try",
      "catch",
      "finally",
      "for",
      "for of",
      "for of",
      "for await",
      "loop",
      "loop",
      "switch",
      "label",
      "nested",
      "nested",
    ] as const);
    let text: string;
    if (place === "block")
      text = `note("ahead");\n{\n${declarations()}\n${wait()}note("in the block");\n${leaves()}\n}\nnote("behind the block");\nreturn count;`;
    else if (place === "body")
      text = `${declarations()}\n${wait()}note("in the body");\n${leaves()}\nnote("at the end");`;
    else if (place === "arrow")
      text = `const inner = ${a}(given: number) => {\n${declarations()}\n${wait()}note("in the arrow function", given);\n${leaves()}\n};\nreturn [${w}inner(1), ${w}inner(2)];`;
    else if (place === "method")
      text = `class Holder {\n${random.pick(["", "static "])}${a}member() {\n${declarations()}\n${wait()}note("in the method", typeof this);\n${leaves()}\n}\n}\nreturn ${w}(Holder as any).member?.() ?? ${w}(new Holder() as any).member();`;
    else if (place === "getter")
      text = `const holder = {\nget member() {\n${isAsync ? "" : declarations()}\nnote("in the getter");\nreturn count;\n},\nset member(given: number) {\nusing r = made("in the setter", "fine");\nnote("in the setter", given);\n},\n};\nholder.member = 1;\nreturn holder.member;`;
    else if (place === "constructor")
      text = `class Above {\nconstructor() {\nnote("in Above");\n}\n}\nclass Below extends Above {\nfield = tell("the field", 1);\nconstructor() {\n${random.chance(0.5) ? `using early = made("ahead of super", "fine");\n` : ""}super();\nusing r = made("behind super", "${random.pick(both)}");\nnote("in Below", this.field);\n}\n}\nreturn new Below();`;
    else if (place === "static block")
      text = `class Holder {\nstatic first = tell("the first static field", 1);\nstatic {\nusing r = made("in the static block", "${random.pick(both)}");\nnote("in the static block", this.first);\n}\nstatic second = tell("the second static field", 2);\n}\nreturn Holder.second;`;
    else if (place === "generator") {
      const reader = random.pick([
        `for ${isAsync ? "await " : ""}(const each of steps()) {\nnote("got", each);\nbreak;\n}`,
        `for ${isAsync ? "await " : ""}(const each of steps()) note("got", each);`,
        `const walk = steps();\nnote("got", ${w}walk.next());\nnote("got", ${w}walk.return("handed in"));\nnote("got", ${w}walk.next());`,
        `const walk = steps();\nnote("got", ${w}walk.next());\nnote("got", ${w}walk.throw(new Error("handed in")));`,
        `const walk = steps();\nnote("got", ${w}walk.return("ahead of the first step"));`,
      ]);
      text = `${a}function* steps(): any {\nnote("the generator begins");\n${declarations()}\nyield 1;\nnote("between the steps");\n{\n${declarations()}\nyield 2;\n}\n${leaves()}\nreturn "the end of the generator";\n}\n${reader}`;
    } else if (place === "try")
      text = `try {\n${declarations()}\n${wait()}note("in try");\n${leaves()}\n} catch (error) {\nnote("caught", describe(error));\n${random.pick(["", "throw error;", `return "from catch";`])}\n} finally {\nnote("in finally");\n${random.pick(["", "", `return "from finally";`])}\n}\nreturn "at the end";`;
    else if (place === "catch")
      text = `try {\nthrow new Error("first");\n} catch (error) {\n${declarations()}\nnote("in catch", describe(error));\n${leaves("throw error;")}\n} finally {\nnote("in finally");\n}\nreturn "at the end";`;
    else if (place === "finally")
      text = `try {\nnote("in try");\n${random.pick(["", `throw new Error("first");`, `return "from try";`])}\n} finally {\n${declarations()}\nnote("in finally");\n${random.pick(["", "", `return "from finally";`])}\n}\nreturn "at the end";`;
    else if (place === "for") {
      const [name, value] = resource(false);
      text = `let turns = 0;\nfor (using ${name} = ${value}; turns < 3; turns++) {\nnote("turn", turns, typeof ${name});\n${leaves("if (turns === 1) break;", "if (turns === 1) continue;")}\n}\nreturn "behind the loop";`;
    } else if (place === "for of") {
      const waits = isAsync && random.chance(0.6);
      const list = Array.from({ length: random.between(0, 3) }, () => resource(waits)[1]).join(", ");
      text = `for (${waits ? "await using" : "using"} each of [${list}]) {\nnote("turn", typeof each);\n${wait()}${leaves("if (count === 1) break;", "if (count === 1) continue;")}\n}\nreturn "behind the loop";`;
    } else if (place === "for await") {
      const list = Array.from({ length: random.between(0, 3) }, () => resource(isAsync)[1]).join(", ");
      text = isAsync
        ? `for await (${random.pick(["using", "await using"])} each of [${list}]) {\nnote("turn", typeof each);\n${leaves("if (count === 1) break;")}\n}\nreturn "behind the loop";`
        : `for (using each of new Set([${list}])) note("turn", typeof each);\nreturn "behind the loop";`;
    } else if (place === "loop")
      text = `${random.pick(["for (let turn = 0; turn < 3; turn++) {", "let turn = -1;\nwhile (++turn < 3) {", "let turn = -1;\ndo {\nturn++;"])}\n${declarations()}\n${wait()}note("turn", turn);\n${leaves("if (turn === 1) break;", "if (turn === 0) continue;", "if (turn === 0) continue;")}\nnote("the end of turn", turn);\n}PLACEHOLDER\nreturn "behind the loop";`;
    else if (place === "switch")
      text = `for (const given of [1, 2, 3]) {\nswitch (given) {\ncase 1: {\n${declarations()}\nnote("in the first clause");\n${random.pick(["break;", "", "continue;"])}\n}\ncase 2: {\n${declarations()}\nnote("in the second clause");\nbreak;\n}\ndefault:\nnote("in the last clause");\n}\nnote("behind the switch");\n}\nreturn count;`;
    else if (place === "label")
      text = `outer: {\n${declarations()}\ninner: {\n${declarations()}\nnote("in both");\n${random.pick(["break outer;", "break inner;", "if (count >= 0) break outer;", ""])}\n}\nnote("behind the inner block");\n}\nreturn "behind both";`;
    else
      text = `{\n${declarations()}\n{\n${declarations()}\n${wait()}note("innermost");\n${leaves()}\n}\nnote("between");\n${declarations()}\n${leaves()}\n}\nreturn "behind both";`;
    text = text.replace("}PLACEHOLDER", text.includes("do {") ? "} while (turn < 2);" : "}");

    const counted = isAsync && random.chance(0.4);
    rows.push(
      `${a}function scene${id}(late: (() => unknown)[]): ${isAsync ? "Promise<any>" : "any"} {\n${text}\n}`,
      `{\nnote("scene ${id}: ${place}");\nconst late: (() => unknown)[] = [];\n${counted ? `jobs = 0;\ncounts = true;\nPromise.resolve().then(passes);\n` : ""}try {\nnote("answers", ${w}scene${id}(late));\n} catch (error) {\nnote("THROWS", describe(error));\n}\n${counted ? `note("jobs", jobs);\ncounts = false;\nawait null;\nawait null;\n` : ""}for (const read of late) note("read later", typeof read());\nnote("count", count);\n}`,
    );
  }

  // What the top of the file declares is disposed of when the file has run, behind the last line.
  const top = random.weighted([
    [3, ""],
    [
      1,
      `using top = { [Symbol.dispose]() {\nconsole.log("disposes of what the top of the file declares", lines.length);\n} };\n`,
    ],
    [
      1,
      `await using top = { async [Symbol.asyncDispose]() {\nawait null;\nconsole.log("disposes of what the top of the file declares", lines.length);\n} };\n`,
    ],
    [
      1,
      `using first = { [Symbol.dispose]() {\nconsole.log("the first of the file");\n} }, second = { [Symbol.dispose]() {\nconsole.log("the second of the file");\n} };\n`,
    ],
  ]);
  return `${head}${top}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\nexport {};\n`;
}
