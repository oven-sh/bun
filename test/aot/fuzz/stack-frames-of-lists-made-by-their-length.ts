// Lists made by their length in the ways programs write it: Array(n) and new Array(n), Array under other names and through other functions,
// Array.from({ length: n }), each alone or with fill, map and other methods behind it. Either the length is one that no list has, or a later call
// of the chain throws or takes a stack trace. Every row stands in another kind of place: a function, a method, a callback of a built-in function,
// an async function, a generator, a function that is called often. It prints what was thrown, and the frames with their places.
import type { Random } from "./random";

// What makes the list: as JavaScript, and as TypeScript accepts it. `null`: it does not.
type Maker = readonly [weight: number, text: (length: string) => string, typed?: ((length: string) => string) | null];
const listOfAnything = (text: (length: string) => string) => (length: string) => `(${text(length)} as any[])`;
const makers: readonly Maker[] = [
  [12, n => `Array(${n})`, n => `Array<any>(${n})`],
  [12, n => `new Array(${n})`, n => `new Array<any>(${n})`],
  [2, n => `(Array)(${n})`],
  [2, n => `new (Array)(${n})`],
  [3, n => `(0, Array)(${n})`, null],
  [3, n => `globalThis.Array(${n})`],
  [3, n => `new globalThis.Array(${n})`],
  [3, n => `Other(${n})`],
  [3, n => `new Other(${n})`],
  [2, n => `holder.Array(${n})`],
  [2, n => `new holder.Array(${n})`],
  [2, n => `Array.call(undefined, ${n})`],
  [2, n => `Array.apply(undefined, [${n}])`],
  [2, n => `Reflect.apply(Array, undefined, [${n}])`],
  [2, n => `Reflect.construct(Array, [${n}])`],
  [2, n => `Array(...[${n}])`],
  [2, n => `new Array(...[${n}])`],
  [1, n => `Array.bind(undefined)(${n})`],
  [1, n => `Array?.(${n})`],
  [1, n => `[].constructor(${n})`, null],
  [1, n => `new [].constructor(${n})`, null],
  [1, n => `Array.prototype.constructor(${n})`, null],
  [2, n => `new Heir(${n})`],
  [6, n => `Array.from({ length: ${n} })`, listOfAnything(n => `Array.from({ length: ${n} })`)],
  [2, n => `Array.from({ length: ${n} }, undefined)`, null],
  [1, n => `Array.of(${n})`, listOfAnything(n => `Array.of(${n})`)],
  [1, n => `[${n}]`, listOfAnything(n => `[${n}]`)],
  [1, n => `Array(${n}, ${n})`, listOfAnything(n => `Array(${n}, ${n})`)],
  [1, n => `new Array(${n}, ${n})`, listOfAnything(n => `new Array(${n}, ${n})`)],
];

const refusedLengths = ["-1", "1.5", "NaN", "2 ** 32", "-0.5", "Infinity", "-Infinity", "4294967296.5", "-2147483649"];
const acceptedLengths = ["0", "1", "2", "3", "-0"];
const otherOperands = ['"a"', "undefined", "null", "true", "{}", '"3"'];

const mappers = [
  "() => frames()",
  "(value, index) => (index ? 0 : frames())",
  "function () {\nreturn frames();\n}",
  "value => {\nthrow new Error(`from the mapper ${value}`);\n}",
  "takesFrames",
  "throws",
  "value => value",
  "(value, index) => index",
  "(value, index, list) => (list ? list.length : -1) + frames()",
  "String",
];

// What stands behind the maker. `mapper` is one of the above.
const chains: readonly (readonly [number, (list: string, mapper: string, any: string) => string])[] = [
  [10, list => list],
  [8, list => `${list}.fill(0)`],
  [2, list => `${list}.fill("")`],
  [4, list => `${list}.fill(next())`],
  [2, list => `${list}.fill(given)`],
  [2, list => `${list}.fill(0, 1)`],
  [10, (list, mapper) => `${list}.fill(0).map(${mapper})`],
  [4, (list, mapper) => `${list}.fill(next()).map(${mapper})`],
  [3, (list, mapper) => `${list}\n.fill(0)\n.map(${mapper})`],
  [3, (list, mapper) => `${list}.map(${mapper})`],
  [2, (list, mapper) => `${list}.fill(0).forEach(${mapper})`],
  [2, (list, mapper) => `${list}.fill(0).filter(${mapper})`],
  [2, (list, mapper) => `${list}.fill(0).flatMap(${mapper})`],
  [2, (list, mapper) => `${list}.fill(0).some(${mapper})`],
  [2, (list, mapper) => `${list}.fill(0).find(${mapper})`],
  [2, (list, mapper) => `${list}.fill(0).reduce(${mapper})`],
  [2, (list, mapper) => `${list}.fill(0).sort(${mapper})`],
  [2, (list, mapper) => `Array.from(${list}, ${mapper})`],
  [2, (list, _, any) => `${list}.fill(0).map(1${any})`],
  [2, (list, _, any) => `${list}.fill(0).toSorted(1${any})`],
  [2, list => `${list}.fill(0).with(9, 1)`],
  [2, (list, _, any) => `${list}.reduce(((left, right) => left + right)${any})`],
  [2, list => `${list}.fill(refusesToBeText).join()`],
  [1, list => `${list}.fill(0).at(0)`],
  [1, list => `${list}.length`],
  [1, list => `${list}.join("-")`],
  [1, list => `${list}.concat([1])`],
  [1, list => `${list}.slice()`],
  [1, list => `[...${list}.keys()]`],
  [1, list => `[...${list}]`],
];

// What is done with the value of the whole expression.
const uses: readonly (readonly [number, (made: string, any: string) => string])[] = [
  [8, made => `const list = ${made};\nreturn list;`],
  [8, made => `return ${made};`],
  [4, made => `${made};\nreturn "nothing thrown";`],
  [4, made => `const list = ${made};\nreturn show(list);`],
  [3, made => `return show(${made});`],
  [2, made => `return void ${made};`],
  [2, made => `return [${made}];`],
  [2, made => `let list;\nlist = ${made};\nreturn list;`],
  [2, (made, any) => (any ? `const list: any = ${made};\nreturn list || 0;` : `return ${made} || 0;`)],
  [2, made => `return calls >= 0 ? ${made} : 0;`],
  [2, made => `const list = ${made};\ncalls++;\nreturn list;`],
  [1, made => `return { list: ${made} };`],
  [1, made => `try {\nreturn ${made};\n} finally {\ncalls++;\n}`],
  [1, made => `try {\nconst list = ${made};\nreturn list;\n} catch (error) {\nthrow error;\n}`],
];

type Place = (
  name: string,
  body: string,
  parameter: string,
  any: string,
) => { declarations: string; call: (length: string) => string };

// Where the statements stand. They read `given` and return.
const places: readonly (readonly [number, Place])[] = [
  [
    8,
    (name, body, parameter) => ({
      declarations: `function ${name}(${parameter}) {\n${body}\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    4,
    (name, body, parameter) => ({
      declarations: `const ${name} = (${parameter}) => {\n${body}\n};`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    3,
    (name, body, parameter) => ({
      declarations: `const table${name} = {\n${name}(${parameter}) {\n${body}\n},\n};`,
      call: n => `table${name}.${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter) => ({
      declarations: `class Class${name} {\n${name}(${parameter}) {\n${body}\n}\n}`,
      call: n => `new Class${name}().${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter) => ({
      declarations: `class Class${name} {\nstatic ${name}(${parameter}) {\n${body}\n}\n}`,
      call: n => `Class${name}.${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter, any) => ({
      declarations: `class Class${name} {\ngiven${any && ": any"};\nconstructor(${parameter}) {\nthis.given = given;\n}\nget ${name}() {\nconst given = this.given;\n${body}\n}\n}`,
      call: n => `new Class${name}(${n}).${name}`,
    }),
  ],
  [
    2,
    (name, body, parameter) => ({
      declarations: `function ${name}(${parameter}) {\nreturn (() => {\n${body}\n})();\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter) => ({
      declarations: `function inner${name}(${parameter}) {\n${body}\n}\nfunction ${name}(${parameter}) {\nconst result = inner${name}(given);\nreturn result;\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    5,
    (name, body, parameter) => ({
      declarations: `function often${name}(${parameter}) {\n${body}\n}\nfunction ${name}(${parameter}) {\nfor (let turn = 0; turn < 3; turn++) {\ntry {\noften${name}(turn & 1);\n} catch {}\n}\nconst result = often${name}(given);\nreturn result;\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    3,
    (name, body, parameter) => ({
      declarations: `function ${name}(${parameter}) {\nreturn [given].map(given => {\n${body}\n})[0];\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter, any) => ({
      declarations: `function ${name}(${parameter}) {\nlet result${any && ": any"};\n[given].forEach(given => {\nresult = (() => {\n${body}\n})();\n});\nreturn result;\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter) => ({
      declarations: `function ${name}(${parameter}) {\nreturn Array.from([given], given => {\n${body}\n})[0];\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter, any) => ({
      declarations: `function ${name}(${parameter}) {\nreturn Reflect.apply(function (given${any && ": any"}) {\n${body}\n}, undefined, [given]);\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter, any) => ({
      declarations: `function ${name}(${parameter}) {\nreturn function (given${any && ": any"}) {\n${body}\n}.call(undefined, given);\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter, any) => ({
      declarations: `function ${name}(${parameter}) {\nconst proxy${any} = new Proxy({}, {\nget() {\n${body}\n},\n});\nreturn proxy.member;\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    3,
    (name, body, parameter) => ({
      declarations: `async function ${name}(${parameter}) {\n${body}\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    3,
    (name, body, parameter) => ({
      declarations: `async function ${name}(${parameter}) {\nawait null;\n${body}\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter) => ({
      declarations: `function ${name}(${parameter}) {\nreturn Promise.resolve(given).then(given => {\n${body}\n});\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter) => ({
      declarations: `function* steps${name}(${parameter}) {\nyield 0;\n${body}\n}\nfunction ${name}(${parameter}) {\nconst steps = steps${name}(given);\nsteps.next();\nreturn steps.next().value;\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter) => ({
      declarations: `function ${name}(${parameter}) {\nfor (const turn of [0]) {\nif (turn) continue;\n${body}\n}\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
  [
    2,
    (name, body, parameter) => ({
      declarations: `function ${name}(${parameter}) {\nswitch (calls >= 0) {\ncase true: {\n${body}\n}\n}\n}`,
      call: n => `${name}(${n})`,
    }),
  ],
];

export function generate(random: Random, isTyped = false): string {
  const any = isTyped ? " as any" : "";
  const anyType = isTyped ? ": any" : "";
  const declarations: string[] = [];
  const attempts: string[] = [];
  for (let row = 0; row < 16; row++) {
    const name = `row${row}`;
    const kind = random.weighted([
      [5, "refused"],
      [4, "accepted"],
      [1, "other"],
    ] as const);
    const length = random.pick(
      kind === "refused" ? refusedLengths : kind === "accepted" ? acceptedLengths : otherOperands,
    );
    // The length is written where the list is made, or it arrives.
    const arrives = random.weighted([
      [6, "parameter"],
      [2, "literal"],
      [1, "default"],
      [1, "local"],
      [1, "sum"],
      [1, "member"],
    ] as const);
    const isNumber = kind !== "other";
    const parameterType = !isTyped ? "" : isNumber && random.chance(0.5) ? ": number" : ": any";
    const operand = {
      parameter: "given",
      literal: `${length}${isNumber ? "" : any}`,
      default: "given",
      local: "local",
      sum: isNumber ? "given + 0" : "given",
      member: "state.given",
    }[arrives];
    const written = makers.filter(maker => !isTyped || maker[2] !== null);
    const maker = random.weighted(written.map(maker => [maker[0], maker] as const));
    const list = ((isTyped && maker[2]) || maker[1])(operand);
    const mapper = random.pick(mappers);
    const made = random.weighted(chains)(list, isTyped ? `(${mapper})${any}` : mapper, any);
    const before =
      arrives === "local" ? "const local = given;\n" : arrives === "member" ? "state.given = given;\n" : "";
    if (random.chance(1 / 12)) {
      // At the top level of the module.
      attempts.push(
        `{\nconst given${parameterType} = ${length}${isNumber ? "" : any};\n${before}let shown;\ntry {\nconst list = ${made};\nshown = show(list);\n} catch (error) {\nshown = describe(error);\n}\nconsole.log(${JSON.stringify(`${row} ${length}`)} + ": " + shown + " (" + calls + " calls)");\n}`,
      );
      continue;
    }
    const body = before + random.weighted(uses)(made, any);
    const parameter =
      arrives === "default" ? `given${parameterType} = ${length}${isNumber ? "" : any}` : `given${parameterType}`;
    const place = random.weighted(places)(name, body, parameter, anyType);
    declarations.push(place.declarations);
    attempts.push(
      `await attempt(${JSON.stringify(`${row} ${length}`)}, () => ${place.call(arrives === "default" ? "" : length + (isNumber ? "" : any))});`,
    );
  }
  return `Error.stackTraceLimit = 30;
function framesIn(stack${anyType})${isTyped ? ": string" : ""} {
  const shown = String(stack)
    .split("\\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, ""))
    .map(line => {
      const place = /^(.*?) ?\\(?[^ ()]*main\\.[cm]?[jt]s:(\\d+):(\\d+)\\)?$/.exec(line);
      return place ? place[1] + "@" + place[2] + ":" + place[3] : line.replace(/ ?\\(.*\\)$/, "") + "@";
    });
  while (shown.length && shown[shown.length - 1].endsWith("@")) shown.pop();
  return shown.join(" < ");
}
const frames = () => framesIn(new Error("taken").stack);
let calls = 0;
const next = () => calls++;
const Other = Array;
const holder = { Array };
const state${isTyped ? ": { given: any }" : ""} = { given: 0 };
class Heir extends Array${isTyped ? "<any>" : ""} {}
const refusesToBeText = {
  toString() {
    throw new TypeError("no text of this");
  },
};
function takesFrames() {
  return frames();
}
function throws(value${anyType}) {
  throw new RangeError("thrown for " + String(value));
}
function show(value${anyType})${isTyped ? ": string" : ""} {
  if (Array.isArray(value)) return "[" + value.length + "] " + value.slice(0, 3).map(show).join(",");
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])) + "}";
  return String(value);
}
function describe(error${anyType})${isTyped ? ": string" : ""} {
  // What a built-in throws has its place in the text of the built-in, which is no matter of the program.
  const isThrownByTheProgram = /main\\.[cm]?[jt]s:\\d+:\\d+\\)?$/.test(String(error.stack).split("\\n")[1]);
  const place = isThrownByTheProgram ? error.line + ":" + error.column : typeof error.line + ":" + typeof error.column;
  return error.name + ": " + error.message.replace(/ \\(evaluating .*\\)$/, "") + " at " + place + " < " + framesIn(error.stack);
}
async function attempt(label${isTyped ? ": string" : ""}, run${isTyped ? ": () => unknown" : ""}) {
  let shown;
  try {
    shown = show(await run());
  } catch (error) {
    shown = describe(error);
  }
  console.log(label + ": " + shown + " (" + calls + " calls)");
}
${declarations.join("\n")}
${attempts.join("\n")}
${isTyped ? "export {};\n" : ""}`;
}
