// Reads that nobody writes: a walk reads `next` and `return` of what it walks, a conversion reads `toString` or `valueOf`, JSON.stringify reads `toJSON`. Some built-in objects add
// a member to their own properties where it is first read, so such a read shows in the order of their keys once the object was copied. A program makes one such read, reads another
// member of the same object by name, ahead of it or behind it, copies the object and lists its keys.
import { generated } from "./generated/run-generated";

const G = `function* counted() { yield 1; yield 2; }\nconst listed = Object.getPrototypeOf(counted.prototype);`;
const AG = `async function* counted() { yield 1; yield 2; }\nconst listed = Object.getPrototypeOf(counted.prototype);`;
const H = `function* counted() { yield 1; yield 2; }\nconst listed = Object.getPrototypeOf(counted().map(x => x));`;
const tail = `console.log(Object.keys({ ...listed }).length);\nconsole.log(Reflect.ownKeys(listed).map(String).join());`;
const T = (name: string) => `try { counted().${name}(new RangeError()); } catch {}`;
const programs: Record<string, string[]> = {
  // generators
  "g-spread": [G, `console.log([...counted()].length);`, T("throw")],
  "g-for-of": [G, `let n = 0; for (const each of counted()) n++; console.log(n);`, T("throw")],
  "g-for-of-break": [G, T("throw"), `for (const each of counted()) break;`, `counted().next;`],
  "g-for-of-break-first": [G, `for (const each of counted()) break;`, T("throw")],
  "g-pattern": [G, `const [first] = counted(); console.log(first);`, T("throw")],
  "g-pattern-empty": [G, `const [] = counted();`, T("throw")],
  "g-pattern-rest": [G, `const [first, ...rest] = counted(); console.log(first, rest.length);`, T("throw")],
  "g-yield-star": [
    G,
    `function* outer() { yield* counted(); } const o = outer(); console.log(typeof o);`,
    T("throw"),
    `console.log(o.next().value);`,
  ],
  "g-yield-star-return": [
    G,
    `function* outer() { yield* counted(); } const o = outer(); o.next(); `,
    T("throw"),
    `o.return(1);`,
  ],
  "g-yield-star-throw": [
    G,
    `function* outer() { yield* counted(); } const o = outer(); o.next(); counted().return(1); try { o.throw(new RangeError()); } catch {}`,
  ],
  "g-array-from": [G, `console.log(Array.from(counted()).length);`, T("throw")],
  "g-map": [G, `function* pairs() { yield [1, 2]; } console.log(new Map(pairs()).size);`, T("throw")],
  "g-set": [G, `console.log(new Set(counted()).size);`, T("throw")],
  "g-promise-all": [G, `console.log(typeof Promise.all(counted()));`, T("throw")],
  "g-call-spread": [G, `console.log(Math.max(...counted()));`, T("throw")],
  "g-new-spread": [G, `console.log(new Array(...counted()).length);`, T("throw")],
  "g-object-from-entries": [
    G,
    `function* pairs() { yield ["a", 2]; } console.log(Object.fromEntries(pairs()).a);`,
    T("throw"),
  ],
  "g-typed-array": [G, `console.log(new Uint8Array(counted()).length);`, T("throw")],
  "g-in-function": [
    G,
    `function walk(g) { let n = 0; for (const each of g) n += each; return n; } console.log(walk(counted()), walk([1]));`,
    T("throw"),
  ],
  "g-hot": [
    G,
    `function walk() { let n = 0; for (const each of counted()) n += each; return n; } let sum = 0; for (let i = 0; i < 3000; i++) sum += walk(); console.log(sum);`,
    T("throw"),
  ],
  "g-never-walked": [
    G,
    `function walk() { let n = 0; for (const each of counted()) n += each; return n; } if (Date.now() < 5) walk();`,
    T("throw"),
  ],
  "g-for-await": [G, `for await (const each of counted()) console.log(each);`, T("throw")],
  "g-method": [
    `class Bag { *[Symbol.iterator]() { yield 1; } }\nfunction* counted() { yield 1; }\nconst listed = Object.getPrototypeOf(counted.prototype);`,
    `console.log([...new Bag()].length);`,
    T("throw"),
  ],
  // async generators
  "ag-for-await-break": [
    AG,
    `counted().throw(new RangeError()).catch(() => {});`,
    `for await (const each of counted()) break;`,
  ],
  "ag-for-await-break-first": [
    AG,
    `for await (const each of counted()) break;`,
    `counted().throw(new RangeError()).catch(() => {});`,
  ],
  "ag-yield-star-return": [
    AG,
    `async function* outer() { yield* counted(); } const o = outer(); await o.next(); counted().throw(new RangeError()).catch(() => {}); await o.return(1);`,
  ],
  // iterator helpers
  "h-spread": [H, `console.log([...counted().map(x => x)].length);`, `counted().map(x => x).return();`],
  "h-for-of-break": [H, `for (const each of counted().map(x => x)) break;`, `counted().map(x => x).next();`],
  "h-return-first": [H, `counted().map(x => x).return();`, `console.log([...counted().filter(x => x)].length);`],
  // conversions
  "error-string": [`const listed = Error.prototype;`, `console.log(String(new Error("e")));`],
  "error-template": [`const listed = Error.prototype;`, 'console.log(`${new Error("e")}`);'],
  "error-concat": [`const listed = Error.prototype;`, `console.log(new TypeError("e") + "");`],
  "date-template": [`const listed = Date.prototype;`, "console.log(typeof `${new Date(0)}`);", `new Date(0).getDay();`],
  "date-concat": [`const listed = Date.prototype;`, `console.log(typeof (new Date(0) + ""));`, `new Date(0).getDay();`],
  "date-number": [
    `const listed = Date.prototype;`,
    `console.log(+new Date(5), new Date(9) - new Date(4), new Date(1) < new Date(2));`,
    `new Date(0).getDay();`,
  ],
  "date-json": [
    `const listed = Date.prototype;`,
    `console.log(JSON.stringify(new Date(0)), JSON.stringify({ at: new Date(0) }));`,
    `new Date(0).getDay();`,
  ],
  "date-string": [
    `const listed = Date.prototype;`,
    `console.log(typeof String(new Date(0)));`,
    `new Date(0).getDay();`,
  ],
  "date-join": [`const listed = Date.prototype;`, `console.log(typeof [new Date(0)].join());`, `new Date(0).getDay();`],
  "number-object": [
    `const listed = Number.prototype;`,
    `console.log(new Number(1) + 1, new Number(2) * 2);`,
    `(1).toFixed(1);`,
  ],
  "boolean-object": [
    `const listed = Boolean.prototype;`,
    "console.log(new Boolean(true) + 1);",
    "console.log(`${new Boolean(false)}`);",
  ],
  "boolean-object-2": [
    `const listed = Boolean.prototype;`,
    "console.log(`${new Boolean(false)}`);",
    "console.log(new Boolean(true) + 1);",
  ],
  "bigint-object": [
    `const listed = BigInt.prototype;`,
    "console.log(Object(1n) + 1n);",
    "console.log(`${Object(2n)}`);",
    `(1n).toLocaleString();`,
  ],
  "symbol-object": [
    `const listed = Symbol.prototype;`,
    `console.log(Object(Symbol.iterator) == Symbol.iterator);`,
    `Symbol("a").toString();`,
  ],
  "promise-all-resolve": [
    `const listed = Promise;`,
    `console.log(typeof Promise.all([1]));`,
    `Promise.reject(1).catch(() => {});`,
  ],
  "promise-race-resolve": [
    `const listed = Promise;`,
    `Promise.reject(1).catch(() => {}); console.log(typeof Promise.race([1]));`,
  ],
  "promise-await": [
    `const listed = Promise;`,
    `await 1; await Promise.any([1]);`,
    `Promise.reject(1).catch(() => {});`,
  ],
  "promise-async-function": [
    `const listed = Promise;`,
    `async function f() { return 1; } async function g() { throw 1; } await f(); await g().catch(() => {});`,
    `Promise.any([1]);`,
  ],
  "promise-finally": [`const listed = Promise.prototype;`, `await Promise.resolve(1).finally(() => {});`],
};

// Every run takes these, whatever else it takes.
const onceWrong = [
  "g-spread",
  "g-for-of",
  "g-for-of-break-first",
  "g-pattern",
  "g-pattern-empty",
  "g-pattern-rest",
  "g-call-spread",
  "g-new-spread",
  "g-object-from-entries",
  "g-in-function",
  "g-hot",
  "date-json",
];

generated(
  "the keys of a built-in object stand in the order of plain Bun behind reads that nobody writes",
  Object.entries(programs).map(([name, lines], index) => ({
    name: `${name}.`,
    isAlwaysRun: index % 4 === 0,
    wasOnceWrong: onceWrong.includes(name),
    isOnlyCompiled: true as const,
    flags: index % 3 === 2 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({ file: "main.mjs", text: [...lines, tail].join("\n") + "\n" }),
  })),
);
