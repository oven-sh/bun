// A file makes something at its top out of what it finds there at that moment. Then what it was made out of changes, and only then does somebody read what was made: it is as it was made.
//
//   made out of   a plain function and what it has under `prototype`, a class and its static members, a literal and its members, a list, a variable that is stored to again
//   made by       `new`, a function that calls `new`, `new` inside a literal, a list or a map, Reflect.construct for itself or for another function, Object.create, a class below the function,
//                 a bound function, `instanceof`, a read, a spread, a copy by a built-in, a function that copies
//   changed by    a store, a store under a key made at run time, Object.defineProperty, Reflect.set, Object.assign, `delete`, text made at run time, a change to the object above
//   changed in    the file that imports it, a third file, a function of the file itself, the file itself below the declaration, a function of a file that the file needs and that needs it,
//                 a CommonJS file, a file loaded by import(), a job
//   read through  an import by name, a namespace, a function of the file, import()
import type { Random } from "./random";

const notes = `export const lines = [];
export function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}
export function attempt(run) {
  try {
    return run();
  } catch (error) {
    return "THROWS " + error.constructor.name;
  }
}
export const pass = value => value;
export const key = ["proto", "type"].join(process.argv.length > 99 ? "x" : "");
`;

type Subject = {
  // What the file declares ahead of what it makes. `exported` names go out of the file.
  declared: string;
  exported: string[];
  // The expression that makes it.
  made: string;
  // Statements that change what it was made out of, in terms of the exported names.
  change: string;
  // What is told about `made`, an expression in terms of it and of the exported names.
  told: (made: string) => string;
};

function constructorFunction(random: Random, id: number): Subject {
  const kind = `Kind${id}`;
  const other = `Other${id}`;
  const second = `{ read() { return "second"; } }`;
  const body = random.pick([
    "",
    "",
    "",
    `this.size = 1;`,
    `this.size = size;`,
    `if (size) this.size = size;`,
    `return undefined;`,
  ]);
  const declaration = random.pick([
    `function ${kind}(size) { ${body} }`,
    `function ${kind}(size) { ${body} }`,
    `const ${kind} = function (size) { ${body} };`,
    `function hidden${id}(size) { ${body} }\nconst ${kind} = hidden${id};`,
    `const ${kind} = pass(function (size) { ${body} });`,
    `const ${kind} = (() => function (size) { ${body} })();`,
  ]);
  const filled = random.pick([
    "",
    "",
    `${kind}.prototype.read = function () { return "first"; };`,
    `${kind}.prototype = { read() { return "replaced at once"; } };`,
  ]);
  const [made, object] = random.pick<[string, (made: string) => string]>([
    [`new ${kind}`, made => made],
    [`new ${kind}()`, made => made],
    [`new ${kind}(3)`, made => made],
    [`make${id}()`, made => made],
    [`(() => new ${kind}())()`, made => made],
    [`{ held: new ${kind}(), beside: [1, 2, 3] }`, made => `${made}.held`],
    [`[new ${kind}(), new ${kind}(2)]`, made => `${made}[1]`],
    [`new Map([["held", new ${kind}()]])`, made => `${made}.get("held")`],
    [`Reflect.construct(${kind}, [])`, made => made],
    [`Reflect.construct(${other}, [], ${kind})`, made => made],
    [`Reflect.construct(Object, [], ${kind})`, made => made],
    [`Object.create(${kind}.prototype)`, made => made],
    [`new (class extends ${kind} {})()`, made => `Object.getPrototypeOf(Object.getPrototypeOf(${made}))`],
    [`new (${kind}.bind(null))()`, made => made],
    [`{ first: ${kind}.prototype, beside: [new ${kind}()] }`, made => `${made}.beside[0]`],
  ]);
  const change = random.pick([
    `${kind}.prototype = null;`,
    `${kind}.prototype = ${second};`,
    `${kind}.prototype = ${second};`,
    `${kind}.prototype = 5;`,
    `${kind}[key] = ${second};`,
    `Object.defineProperty(${kind}, "prototype", { value: ${second} });`,
    `Reflect.set(${kind}, "prototype", ${second});`,
    `Object.assign(${kind}, { prototype: ${second} });`,
    `new Function("callable", "callable.prototype = { read() { return 'second'; } };")(${kind});`,
    `[${kind}].forEach(each => { each.prototype = ${second}; });`,
    `Object.setPrototypeOf(${kind}.prototype, { read() { return "above"; } });`,
    `${kind}.prototype.read = () => "patched";`,
    `Object.defineProperty(${kind}.prototype, "size", { set(value) { note("a setter ran for", value); }, configurable: true });`,
  ]);
  return {
    declared: `${declaration}\nfunction ${other}() {}\nfunction make${id}() { return new ${kind}(); }\n${filled}\nconst before${id} = ${kind}.prototype;`,
    exported: [kind, `before${id}`],
    made,
    change,
    told: name => {
      const it = object(name);
      return `attempt(() => typeof ${it}.read === "function" ? ${it}.read() : typeof ${it}.read), Object.getPrototypeOf(${it}) === before${id}, Object.getPrototypeOf(${it}) === Object.prototype, attempt(() => ${it} instanceof ${kind}), Object.keys(${it}).join()`;
    },
  };
}

function classWithStatics(random: Random, id: number): Subject {
  const kind = `Kind${id}`;
  return {
    declared: `class Base${id} { constructor() { this.from = "base"; } }\nclass Spare${id} { constructor() { this.from = "spare"; } }\nclass ${kind} extends Base${id} { static size = 1; static make() { return new this(); } constructor() { super(); this.size = ${kind}.size; } }`,
    exported: [kind, `Spare${id}`],
    made: random.pick([
      `new ${kind}()`,
      `${kind}.make()`,
      `[new ${kind}()][0]`,
      `Reflect.construct(${kind}, [])`,
      `(() => new ${kind}())()`,
    ]),
    change: random.pick([
      `${kind}.size = 2;`,
      `Object.setPrototypeOf(${kind}, Spare${id});`,
      `${kind}.make = () => "replaced";`,
      `Object.defineProperty(${kind}, "size", { get() { return "got"; } });`,
      `Object.defineProperty(${kind}.prototype, "size", { set(value) { note("a setter ran for", value); }, configurable: true });`,
      `delete ${kind}.size;`,
    ]),
    told: made => `${made}, ${made} instanceof ${kind}`,
  };
}

function literal(random: Random, id: number): Subject {
  const holder = `holder${id}`;
  return {
    declared: `const ${holder} = { size: 1, list: [1, 2], inner: { deep: "first" }, read() { return this.size; } };\nfunction copy${id}(from) { return { size: from.size, length: from.list.length, deep: from.inner.deep }; }`,
    exported: [holder],
    made: random.pick([
      `{ ...${holder} }`,
      `[${holder}.size, ${holder}.size + 1, ${holder}.list.length]`,
      `Object.keys(${holder})`,
      `Object.entries(${holder}.inner)`,
      `JSON.stringify(${holder})`,
      `${holder}.list.slice()`,
      `[...${holder}.list]`,
      `[...new Set(${holder}.list)]`,
      `${holder}.list.map(each => each * 2)`,
      `copy${id}(${holder})`,
      `{ told: ${holder}.read(), has: "size" in ${holder}, more: "more" in ${holder} }`,
      `Object.assign({}, ${holder}.inner, { beside: [1, 2, 3] })`,
      `{ text: \`\${${holder}.size} of \${${holder}.list}\`, beside: [1, 2, 3] }`,
    ]),
    change: random.pick([
      `${holder}.size = 2;`,
      `${holder}.more = 1;`,
      `delete ${holder}.size;`,
      `${holder}.list.push(3);`,
      `${holder}.list.length = 0;`,
      `${holder}.list[0] = "changed";`,
      `${holder}.inner.deep = "second";`,
      `${holder}.inner = { deep: "another", wide: true };`,
      `${holder}.read = () => "replaced";`,
      `Object.defineProperty(${holder}, "size", { get() { return "got"; }, enumerable: true });`,
      `Object.setPrototypeOf(${holder}, { more: "above" });`,
      `Object.assign(${holder}, { size: 3, list: [] });`,
    ]),
    told: made => made,
  };
}

function variable(random: Random, id: number): Subject {
  return {
    declared: `let count${id} = 1;\nfunction step${id}() { count${id}++; }\nfunction counted${id}() { return { count: count${id}, beside: [1, 2, 3] }; }`,
    exported: [`step${id}`],
    made: random.pick([
      `[count${id}, count${id} + 1, [1, 2, 3]]`,
      `{ count: count${id}, beside: [1, 2, 3] }`,
      `counted${id}()`,
      `new Map([["count", count${id}]]).get("count")`,
      `[counted${id}()]`,
    ]),
    change: `step${id}();`,
    told: made => made,
  };
}

export function generate(random: Random): { text: string; files: Record<string, string> } {
  const files: Record<string, string> = { "notes.js": notes };
  const tools = `import { note, attempt, pass, key } from "./notes.js";\n`;
  const imports: string[] = [];
  const rows: string[] = [];
  const functions: string[] = [];

  const count = random.between(2, 5);
  for (let id = 0; id < count; id++) {
    const subject = random.weighted<(random: Random, id: number) => Subject>([
      [6, constructorFunction],
      [2, classWithStatics],
      [2, literal],
      [1, variable],
    ])(random, id);
    const names = subject.exported.join(", ");
    const road = random.pick([
      "importer",
      "importer",
      "third file",
      "own function",
      "below",
      "circle",
      "commonjs",
      "import()",
      "job",
      "function of the importer",
    ] as const);
    const drawn = random.pick(["name", "name", "namespace", "function", "import()"] as const);
    // The first file waits for an import() of a file that needs it, and that file is through when the first file is: neither ever is.
    const reader = road === "circle" && drawn === "import()" ? "name" : drawn;
    const changer = `function change${id}(${names}) {\n${subject.change}\n}`;

    let head = tools;
    let tail = "";
    if (road === "own function") tail += `export function change${id}() {\n${subject.change}\n}\n`;
    if (road === "below") tail += `${subject.change}\n`;
    if (road === "circle") {
      head += `import { change${id} } from "./main.js";\n`;
      tail += `change${id}(${names});\n`;
      functions.push(`export ${changer}`);
    }
    files[`declared${id}.js`] =
      `${head}${subject.declared}\nexport { ${names} };\nexport const made${id} = ${subject.made};\nexport function read${id}() {\nreturn made${id};\n}\n${tail}`;

    imports.push(`import { ${names} } from "./declared${id}.js";`);
    switch (road) {
      case "importer":
        rows.push(subject.change);
        break;
      case "third file":
        files[`changes${id}.js`] = `${tools}import { ${names} } from "./declared${id}.js";\n${subject.change}\n`;
        imports.push(`import "./changes${id}.js";`);
        break;
      case "own function":
        imports.push(`import { change${id} } from "./declared${id}.js";`);
        rows.push(`change${id}();`);
        break;
      case "commonjs":
        files[`changes${id}.cjs`] = `const { note, key } = require("./notes.js");\nmodule.exports = ${changer};\n`;
        imports.push(`import change${id} from "./changes${id}.cjs";`);
        rows.push(`change${id}(${names});`);
        break;
      case "import()":
        files[`changes${id}.js`] = `${tools}import { ${names} } from "./declared${id}.js";\n${subject.change}\n`;
        rows.push(`await import("./changes${id}.js");`);
        break;
      case "job":
        rows.push(`await Promise.resolve().then(() => {\n${subject.change}\n});`);
        break;
      case "function of the importer":
        functions.push(changer);
        rows.push(`change${id}(${names});`);
        break;
      case "below":
      case "circle":
        break;
    }

    let made = `made${id}`;
    switch (reader) {
      case "name":
        imports.push(`import { made${id} } from "./declared${id}.js";`);
        break;
      case "namespace":
        imports.push(`import * as space${id} from "./declared${id}.js";`);
        made = `space${id}.made${id}`;
        break;
      case "function":
        imports.push(`import { read${id} } from "./declared${id}.js";`);
        made = `read${id}()`;
        break;
      case "import()":
        rows.push(`const { made${id} } = await import("./declared${id}.js");`);
        break;
    }
    rows.push(`note("${id}:", ${subject.told(made)});`);
  }

  return {
    text: `import { note, attempt, pass, key, lines } from "./notes.js";\n${imports.join("\n")}\n${functions.join("\n")}\n${rows.join("\n")}\nconsole.log(lines.join("\\n"));\n`,
    files,
  };
}
