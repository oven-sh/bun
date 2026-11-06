// A declared type is a claim of whoever writes it. A value of another kind reaches a place of a primitive type through `any`, a test looks at it there, and what stands behind
// the test uses it. Every step does what plain Bun does with that value. A program draws one to four scenes, each of
//   a type      what the place declares: bigint, string, number, boolean, symbol, null, undefined, listed texts or numbers, an enum, a union of two of them
//   arrivals    which values reach the place: lists, objects, functions, the very object it is compared with, primitives of another kind
//   a place     where the value is kept: a constant of the module or of a function, a parameter, a variable that a closure reads, a field, an element
//   tests       what looks at it first: a switch, ===, !==, typeof, instanceof, in, its truth, ?., ??
//   uses        what is done with it behind the tests: a read, a store or a call under a key, arithmetic, a template, a spread, a pattern ..
// Every scene has names of its own: what the compiler learns about one scene says nothing about the next.
import type { Random } from "./random";

export const head = `function describe(value: unknown): string {
  // The text of a function is laid out by whoever prints it.
  if (typeof value === "string") return JSON.stringify(value.replace(/\\s+/g, " "));
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol" || typeof value === "function") return typeof value;
  if (Array.isArray(value)) return "[" + value.map(describe).join(", ") + "]";
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).map(key => key + ": " + describe(record[key])).join(", ") + "}";
  }
  return Object.is(value, -0) ? "-0" : String(value);
}
function classOf(error: unknown): string {
  return "THREW " + (error as Error).constructor.name;
}
const lengthKey: string = ["len", "gth"].join("");
const nameKey: string = ["na", "me"].join("");
const callKey: string = ["ca", "ll"].join("");
const firstIndex: number = [].length;
const objectKey: string = {} as any;
const marker = { name: "marker" };
class Other {
  other = 1;
  name = "other";
}
enum Level {
  Low,
  High,
}
enum Color {
  Red = "red",
  Blue = "blue",
}
`;

/** In every text `X` reads the value at its declared type and `W` is that type. */
export type Declared = {
  type: string;
  /** Tests and uses that TypeScript takes for this type alone. */
  tests: string[];
  uses: string[];
};

const switchOver = (...cases: string[]) =>
  `switch (X) {\n${cases.map(value => `  case ${value}:\n    out.push(${JSON.stringify("case " + value)});\n    break;\n`).join("")}  default:\n    out.push("no case");\n}`;
const ofTexts = [
  `out.push(describe(X + "!"));`,
  `out.push(describe(X.length));`,
  `out.push(describe(X.toUpperCase()));`,
];
const ofNumbers = [
  `out.push(describe(X + 1));`,
  `out.push(describe(X * 2), describe(X - 1), describe(-X));`,
  `out.push(describe(X | 0), describe(X < 5), describe(X >= 5));`,
  `out.push(describe(X.toFixed(1)));`,
  `out.push(describe([10, 20, 30][X]));`,
];

export const declaredTypes: Record<string, Declared> = {
  "bigint": {
    type: `bigint`,
    tests: [`if (X === 1n) out.push("one");`, switchOver(`1n`, `2n`)],
    uses: [`out.push(describe(X + 1n));`, `out.push(describe(X * 2n), describe(-X), describe(X < 5n));`],
  },
  "string": {
    type: `string`,
    tests: [`if (X === "text") out.push("the text");`, switchOver(`"text"`, `"low"`)],
    uses: ofTexts,
  },
  "number": { type: `number`, tests: [`if (X === 7) out.push("seven");`, switchOver(`1`, `7`)], uses: ofNumbers },
  "boolean": {
    type: `boolean`,
    tests: [`if (X === true) out.push("true");`, switchOver(`true`, `false`)],
    uses: [`out.push(describe(X ? 1 : 2), describe(!X), describe(X && "and"), describe(X || "or"));`],
  },
  "symbol": {
    type: `symbol`,
    tests: [`if (X === Symbol.iterator) out.push("the iterator");`],
    uses: [`out.push(describe(X.description));`, `out.push(describe(({ [X]: 1 } as any)[X]));`],
  },
  "null": { type: `null`, tests: [`if (X === null) out.push("null");`], uses: [`out.push(describe(X ?? "nothing"));`] },
  "undefined": {
    type: `undefined`,
    tests: [`if (X === undefined) out.push("undefined");`],
    uses: [`out.push(describe(X ?? "nothing"));`],
  },
  "listed-texts": {
    type: `"low" | "high"`,
    tests: [`if (X === "low") out.push("low");`, switchOver(`"low"`, `"high"`)],
    uses: ofTexts,
  },
  "listed-numbers": {
    type: `1 | 2 | 3`,
    tests: [`if (X === 2) out.push("two");`, switchOver(`1`, `2`, `3`)],
    uses: ofNumbers,
  },
  "an-enum-of-numbers": {
    type: `Level`,
    tests: [`if (X === Level.High) out.push("high");`, switchOver(`Level.Low`, `Level.High`)],
    uses: [`out.push(describe(X + 1), describe(Level[X]));`],
  },
  "an-enum-of-texts": {
    type: `Color`,
    tests: [`if (X === Color.Red) out.push("red");`, switchOver(`Color.Red`, `Color.Blue`)],
    uses: ofTexts,
  },
  "a-number-or-a-string": {
    type: `number | string`,
    tests: [`if (X === 7) out.push("seven");`, switchOver(`7`, `"text"`)],
    uses: [`out.push(describe(typeof X === "number" ? X + 1 : X.length));`],
  },
  "a-bigint-or-undefined": {
    type: `bigint | undefined`,
    tests: [
      `if (X === undefined) out.push("undefined");`,
      `try {\n  if (X !== undefined) out.push(describe(X + 1n));\n} catch (error) {\n  out.push(classOf(error));\n}`,
    ],
    uses: [`out.push(describe(X ?? 0n));`, `out.push(describe(X! + 1n));`],
  },
  "a-string-or-null": {
    type: `string | null`,
    tests: [
      `if (X === null) out.push("null");`,
      `try {\n  if (X !== null) out.push(describe(X.length));\n} catch (error) {\n  out.push(classOf(error));\n}`,
    ],
    uses: [`out.push(describe(X?.length));`, `out.push(describe(X!.length));`],
  },
};

export const arrivals: Record<string, string> = {
  "a-list": `[1, 2, 3]`,
  "an-empty-list": `[]`,
  "a-list-of-texts": `["a", "b"]`,
  "a-literal": `{ name: "literal", length: 2 }`,
  "an-instance": `new Other()`,
  "a-function": `function named() {\n  return "called";\n}`,
  "a-list-of-floats": `new Float32Array(2)`,
  "a-map": `new Map([["key", 1]])`,
  "a-constructor": `Float32Array`,
  "the-marker": `marker`,
  "a-text": `"text"`,
  "an-empty-text": `""`,
  "a-listed-text": `"low"`,
  "a-whole-number": `7`,
  "a-listed-number": `2`,
  "zero": `0`,
  "a-fraction": `1.5`,
  "not-a-number": `NaN`,
  "a-bigint": `1n`,
  "a-symbol": `Symbol.iterator`,
  "true": `true`,
  "false": `false`,
  "null": `null`,
  "undefined": `undefined`,
};

/** Tests that TypeScript takes whatever the type is. */
export const tests: Record<string, string> = {
  "a-switch-with-a-constructor": `switch (X as any) {\n  case Float32Array as any:\n    out.push("the constructor");\n}`,
  "a-switch-with-an-empty-case": `switch (X as any) {\n  case Float32Array as any:\n}`,
  "a-switch-with-the-marker": `switch (X as any) {\n  case marker:\n    out.push("the marker");\n    break;\n  case 7:\n    out.push("seven");\n    break;\n  default:\n    out.push("no case");\n}`,
  "equal-to-the-marker": `if ((X as any) === marker) out.push("the marker");`,
  "not-equal-to-the-marker": `if ((X as any) !== marker) out.push("not the marker");`,
  "equal-to-the-marker-or-gone": `if ((X as any) === marker) {\n  out.push("the marker");\n  LEAVE\n}`,
  "equal-to-a-boolean": `if ((X as any) === true) out.push("true");`,
  "equal-to-null": `if ((X as any) === null) out.push("null");`,
  "equal-to-undefined": `if ((X as any) === undefined) out.push("undefined");`,
  "loosely-equal-to-null": `if (X == null) out.push("nothing");`,
  "loosely-equal-to-the-marker": `if ((X as any) == marker) out.push("the marker");`,
  "typeof-object": `if (typeof X === "object") out.push("an object");`,
  "typeof-function": `if (typeof X === "function") out.push("a function");`,
  "typeof-its-own-kind": `if (typeof X === "bigint" || typeof X === "string" || typeof X === "number") out.push("a primitive");`,
  "a-switch-over-typeof": `switch (typeof X) {\n  case "object":\n    out.push("an object");\n    break;\n  case "number":\n    out.push("a number");\n    break;\n  default:\n    out.push("another kind");\n}`,
  "instanceof": `if ((X as any) instanceof Other) out.push("an Other");`,
  "instanceof-array": `if ((X as any) instanceof Array) out.push("an Array");`,
  "is-array": `if (Array.isArray(X)) out.push("a list");`,
  "in": `try {\n  if ("name" in (X as any)) out.push("has a name");\n} catch (error) {\n  out.push(classOf(error));\n}`,
  "truth": `if (X) out.push("truthy");`,
  "falsehood": `if (!X) out.push("falsy");`,
  "a-conditional": `out.push(X ? "truthy" : "falsy");`,
  "an-optional-chain": `if ((X as any)?.name) out.push("named");`,
  "nullish": `out.push(describe(typeof (X ?? "nothing")));`,
  "two-comparisons": `if ((X as any) === marker || (X as any) === Float32Array) out.push("one of two");`,
  "a-loop-that-compares": `for (let step = 0; step < 2 && (X as any) !== marker; step++) out.push("step");`,
};

/** Uses that TypeScript takes whatever the type is. Any of them may throw. */
export const uses: Record<string, string> = {
  "a-read-under-a-key": `out.push(describe((X as any)[lengthKey]));`,
  "a-read-under-another-key": `out.push(describe((X as any)[nameKey]));`,
  "a-read-under-an-index": `out.push(describe((X as any)[firstIndex]));`,
  "a-read-under-an-object": `out.push(describe((X as any)[objectKey as any]));`,
  "a-read-by-name": `out.push(describe((X as any).length), describe((X as any).name));`,
  "a-store-under-a-key": `(X as any)[nameKey] = "stored";\nout.push(describe((X as any)[nameKey]));`,
  "a-store-under-an-index": `(X as any)[firstIndex] = 9;\nout.push(describe((X as any)[firstIndex]));`,
  "a-store-by-name": `(X as any).name = "stored";\nout.push(describe((X as any).name));`,
  "a-compound-store-under-a-key": `(X as any)[lengthKey] += 1;\nout.push(describe((X as any)[lengthKey]));`,
  "a-removal-under-a-key": `out.push(describe(delete (X as any)[nameKey]), describe((X as any)[nameKey]));`,
  "the-value-as-a-key": `const table: any = {};\ntable[X as any] = 1;\nout.push(describe(Reflect.ownKeys(table).length));`,
  "a-call": `out.push(describe((X as any)()));`,
  "a-call-under-a-key": `out.push(describe((X as any)[callKey]()));`,
  "a-call-of-a-method": `out.push(describe((X as any).toString()));`,
  "a-construction": `out.push(describe(typeof new (X as any)(1)));`,
  "a-sum": `out.push(describe((X as any) + 1));`,
  "a-product": `out.push(describe((X as any) * 2), describe(-(X as any)), describe((X as any) | 0));`,
  "an-order": `out.push(describe((X as any) < 5), describe((X as any) >= 5));`,
  "a-count": `let counted: W = X;\n(counted as any)++;\nout.push(describe(counted));`,
  "a-template": `out.push(describe(\`<\${X as any}>\`));`,
  "a-joined-text": `out.push(describe((X as any) + "!"));`,
  "a-spread-into-a-list": `out.push(describe([...(X as any)]));`,
  "a-spread-into-a-literal": `out.push(describe({ ...(X as any) }));`,
  "a-spread-into-a-call": `out.push(describe(Math.max(...(X as any))));`,
  "a-pattern-of-names": `const { length, name } = X as any;\nout.push(describe(length), describe(name));`,
  "a-pattern-of-places": `const [first, second] = X as any;\nout.push(describe(first), describe(second));`,
  "a-loop-over-keys": `for (const key in X as any) out.push(key);`,
  "a-loop-over-values": `for (const value of X as any) out.push(describe(value));`,
  "its-kind": `out.push(typeof X);`,
  "its-text": `out.push(describe(String(X)));`,
  "its-json": `out.push(describe(JSON.stringify(X)));`,
  "its-keys": `out.push(describe(Object.keys(X as any)));`,
  "itself": `out.push(describe(X));`,
  "an-argument": `out.push(describe(take(X)));`,
  "a-copy": `const copy: W = X;\nout.push(describe(copy), describe((copy as any)[lengthKey]));`,
  "an-element": `const row: W[] = [X];\nout.push(describe(row), describe((row[0] as any)[lengthKey]));`,
  "a-property": `const record: { kept: W } = { kept: X };\nout.push(describe(record), describe((record.kept as any)[nameKey]));`,
  "a-loose-comparison": `out.push(describe((X as any) == 7), describe((X as any) == "text"), describe(Object.is(X, X)));`,
  "a-second-comparison": `out.push(describe((X as any) === marker), describe((X as any) === Float32Array));`,
  "a-key-asked-for": `out.push(describe(nameKey in (X as any)));`,
};

/** `BODY` is the tests and the uses, `FIRST` the first arrival, `NEXT` the arrival of a turn, `TURNS` how many turns there are. */
export type Place = { read: string; text: string; leave: string };

const inFunction = (body: string) => `function run(out: string[]) {\n${body}\n}\nrun(out);`;
const eachTurn = (step: string, body: string) => `for (let turn = 0; turn < TURNS; turn++) {\n${step}\n${body}\n}`;

export const places: Record<string, Place> = {
  "a-constant-of-the-module": { read: `held`, leave: `break scene;`, text: `const held: W = FIRST;\nBODY` },
  "a-constant-of-a-function": { read: `held`, leave: `return;`, text: inFunction(`const held: W = FIRST;\nBODY`) },
  "a-constant-of-a-loop": {
    read: `held`,
    leave: `continue;`,
    text: inFunction(eachTurn(`const held: W = NEXT;`, `BODY`)),
  },
  "a-parameter": {
    read: `held`,
    leave: `return;`,
    text: `function use(held: W, out: string[]) {\nBODY\n}\nfor (let turn = 0; turn < TURNS; turn++) use(NEXT, out);`,
  },
  "a-variable-that-a-closure-reads": {
    read: `held`,
    leave: `continue;`,
    text: inFunction(
      `let held: W = FIRST;\nconst read = () => held;\n` +
        eachTurn(`held = NEXT;`, `BODY`) +
        `\nout.push(describe(read()));`,
    ),
  },
  "a-field-of-an-instance": {
    read: `holder.held`,
    leave: `continue;`,
    text:
      `class Holder {\n  held: W = FIRST;\n}\n` +
      inFunction(`const holder = new Holder();\n` + eachTurn(`holder.held = NEXT;`, `BODY`)),
  },
  "an-element-of-a-list": {
    read: `kept[0]`,
    leave: `continue;`,
    text: inFunction(`const kept: W[] = [FIRST];\n` + eachTurn(`kept[0] = NEXT;`, `BODY`)),
  },
};

const guarded = (use: string) => `try {\n${use}\n} catch (error) {\n  out.push(classOf(error));\n}`;

export type Scene = {
  declared: Declared;
  arrivals: string[];
  place: Place;
  tests: string[];
  uses: string[];
  turns: number;
};

/** A block of its own, so that no name of one scene is a name of another. */
export function writeScene(scene: Scene): string {
  const given = scene.arrivals.map(value => `((${value}) as any)`);
  const next = given
    .map((value, index) => (index === given.length - 1 ? value : `turn % ${given.length} === ${index} ? ${value} : `))
    .join("");
  const body = [...scene.tests, ...scene.uses.map(guarded)].join("\n");
  return (
    `scene: {\nconst out: string[] = [];\nfunction take(value: W): unknown {\n  return value;\n}\n` +
    scene.place.text.replaceAll("BODY", () => body) +
    `\nconsole.log(out.join(" | "));\n}`
  )
    .replaceAll(
      "LEAVE",
      scene.place.leave === "break scene;" ? `console.log(out.join(" | "));\n  break scene;` : scene.place.leave,
    )
    .replaceAll("FIRST", () => given[0])
    .replaceAll("NEXT", () => next)
    .replaceAll("TURNS", String(scene.turns))
    .replaceAll(/\bX\b/g, scene.place.read)
    .replaceAll(/\bW\b/g, scene.declared.type.includes("|") ? `(${scene.declared.type})` : scene.declared.type);
}

export function generate(random: Random): string {
  const scenes = Array.from({ length: random.between(1, 4) }, () => {
    const declared = declaredTypes[random.pick(Object.keys(declaredTypes))];
    const given = Array.from(
      {
        length: random.weighted([
          [5, 1],
          [3, 2],
          [1, 3],
        ]),
      },
      () => arrivals[random.pick(Object.keys(arrivals))],
    );
    const allTests = [...Object.values(tests), ...declared.tests];
    // The built-in objects of a compiled program are not all open to change.
    const isBuiltin = given.includes(arrivals["a-constructor"]);
    const allUses = [
      ...Object.keys(uses)
        .filter(name => !isBuiltin || !/store|removal/.test(name))
        .map(name => uses[name]),
      ...declared.uses,
    ];
    return writeScene({
      declared,
      arrivals: given,
      place: places[random.pick(Object.keys(places))],
      tests: Array.from(
        {
          length: random.weighted([
            [6, 1],
            [2, 2],
            [1, 0],
          ]),
        },
        () => random.pick(allTests),
      ),
      uses: Array.from({ length: random.between(1, 5) }, () => random.pick(allUses)),
      turns: given.length * random.pick([1, 2, 2, 40]),
    });
  });
  return head + scenes.join("\n") + "\nexport {};\n";
}
