// A type argument is a claim of whoever writes it. A value of another kind goes in through `any`, passes through the type parameter by some road, is kept in a place whose type
// says otherwise, and every use of it there does what plain Bun does with that value. A program draws one to three scenes, each of
//   a road      how the value passes through the type parameter: a function, a method, a field of a generic class, a container, a callback of an array method ..
//   a place     where what comes out is kept: a constant, a variable that a closure reads, a variable of the module, a field, an element, a parameter
//   arrivals    which values reach that place, one after the other
//   uses        what is done with the value where it is kept
// Every scene has types, a road and a place of its own: what the compiler learns about one scene says nothing about the next.
import type { Random } from "./random";

const head = `function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
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
`;

type Road = {
  /** `N` is the number of the case, `W` the type that the place declares. */
  declare: string;
  /** `V` is the value, already `any`. */
  call: string;
  waits?: boolean;
  /** The value goes through text. */
  parses?: boolean;
};

const throughBody = (body: string): Road => ({
  declare: `function passN<T>(value: T): T {\n  ${body}\n}`,
  call: `passN<W>(V)`,
});

const roads: Record<string, Road> = {
  "a-function": throughBody(`return value;`),
  "nothing-but-any": { declare: ``, call: `V` },
  "a-function-that-answers-any": {
    declare: `function anyN(value: unknown): any {\n  return value;\n}`,
    call: `anyN(V)`,
  },
  "a-function-whose-type-argument-is-inferred": {
    declare: `function passN<T>(value: T): T {\n  return value;\n}`,
    call: `passN(V as W)`,
  },
  "a-function-given-unknown": {
    declare: `function passN<T>(value: T): T {\n  return value;\n}`,
    call: `passN<W>(V as unknown as W)`,
  },
  "an-arrow": { declare: `const passN = <T,>(value: T): T => value;`, call: `passN<W>(V)` },
  "a-method": {
    declare: `class CarrierN {\n  pass<T>(value: T): T {\n    return value;\n  }\n}\nconst carrierN = new CarrierN();`,
    call: `carrierN.pass<W>(V)`,
  },
  "a-static-method": {
    declare: `class CarrierN {\n  static pass<T>(value: T): T {\n    return value;\n  }\n}`,
    call: `CarrierN.pass<W>(V)`,
  },
  "a-method-of-a-literal": {
    declare: `const carrierN = {\n  pass<T>(value: T): T {\n    return value;\n  },\n};`,
    call: `carrierN.pass<W>(V)`,
  },
  "a-field-of-a-generic-class": {
    declare: `class BoxN<T> {\n  constructor(public value: T) {}\n}`,
    call: `new BoxN<W>(V).value`,
  },
  "a-getter-of-a-generic-class": {
    declare: `class BoxN<T> {\n  #value: T;\n  constructor(value: T) {\n    this.#value = value;\n  }\n  get value(): T {\n    return this.#value;\n  }\n}`,
    call: `new BoxN<W>(V).value`,
  },
  "a-generic-class-with-a-map-of-its-own": {
    declare: `class BoxN<T> {\n  constructor(public value: T) {}\n  map<U>(change: (value: T) => U): BoxN<U> {\n    return new BoxN<U>(change(this.value));\n  }\n}\nfunction passN<T>(value: T): T {\n  return new BoxN<T>(value).map<T>(inner => inner).value;\n}`,
    call: `passN<W>(V)`,
  },
  "a-heir-of-a-generic-class": {
    declare: `class BaseN<T> {\n  constructor(public value: T) {}\n}\nclass HeirN extends BaseN<W> {}`,
    call: `new HeirN(V).value`,
  },
  "a-bound": { declare: `function passN<T extends W>(value: T): T {\n  return value;\n}`, call: `passN<W>(V)` },
  "a-bound-that-is-inferred": {
    declare: `function passN<T extends W>(value: T): T {\n  return value;\n}`,
    call: `passN(V)`,
  },
  "a-default": { declare: `function passN<T = W>(value: T): T {\n  return value;\n}`, call: `passN(V)` },
  "a-default-below-a-default": {
    declare: `function passN<T = number, R extends T = T>(value: R): R {\n  return value;\n}`,
    call: `passN<W>(V)`,
  },
  "an-overload": {
    declare: `function passN(value: number): number;\nfunction passN(value: string): string;\nfunction passN<T>(value: T): T;\nfunction passN(value: unknown): unknown {\n  return value;\n}`,
    call: `passN<W>(V)`,
  },
  "a-predicate-that-says-yes": {
    declare: `function isAlwaysN<T>(value: unknown): value is T {\n  return true;\n}\nfunction passN<T>(value: unknown): T {\n  if (isAlwaysN<T>(value)) return value;\n  return value as T;\n}`,
    call: `passN<W>(V)`,
  },
  "a-predicate-that-says-no": {
    declare: `function isNeverN<T>(value: unknown): value is T {\n  return false;\n}\nfunction passN<T>(value: T | string): T {\n  if (isNeverN<string>(value)) return value.length as unknown as T;\n  return value as T;\n}`,
    call: `passN<W>(V)`,
  },
  "a-mapped-and-a-conditional-type": {
    declare: `type SameN<T> = { [K in keyof T]: T[K] };\ntype ElementsN<T> = T extends readonly (infer E)[] ? E : never;\nfunction passN<T>(value: T): T {\n  const list: SameN<T[]> = [value];\n  const first: ElementsN<typeof list> = list[0];\n  return first;\n}`,
    call: `passN<W>(V)`,
  },
  "a-key-of-a-type-parameter": {
    declare: `function readKeyN<T, K extends keyof T>(holder: T, key: K): T[K] {\n  return holder[key];\n}\nfunction passN<T>(value: T): T {\n  return readKeyN({ held: value }, "held");\n}`,
    call: `passN<W>(V)`,
  },
  "a-list": throughBody(`return [value][0];`),
  "a-list-that-is-pushed-to": throughBody(`const list: T[] = [];\n  list.push(value);\n  return list[0];`),
  "a-list-that-is-popped": throughBody(`return [value].pop()!;`),
  "a-pair": { declare: `function pairN<T>(value: T): [T, T] {\n  return [value, value];\n}`, call: `pairN<W>(V)[1]` },
  "an-object": throughBody(`return { held: value }.held;`),
  "a-record": throughBody(`const record: Record<string, T> = {};\n  record.held = value;\n  return record.held;`),
  "a-map": throughBody(`return new Map<string, T>([["key", value]]).get("key")!;`),
  "a-key-of-a-map": throughBody(`return [...new Map<T, number>([[value, 1]]).keys()][0];`),
  "a-set": throughBody(`return [...new Set<T>([value])][0];`),
  "a-spread-list": throughBody(`return [...[value]][0];`),
  "a-spread-object": throughBody(`return { ...{ held: value } }.held;`),
  "spread-arguments": {
    declare: `function lastN<T>(first: T, second: T): T {\n  return second;\n}\nfunction passN<T>(value: T): T {\n  const both: [T, T] = [value, value];\n  return lastN<T>(...both);\n}`,
    call: `passN<W>(V)`,
  },
  "a-rest-parameter": {
    declare: `function passN<T>(...values: T[]): T {\n  return values[0];\n}`,
    call: `passN<W>(V)`,
  },
  "a-list-taken-apart": throughBody(`const [first] = [value];\n  return first;`),
  "an-object-taken-apart": throughBody(`const { held } = { held: value };\n  return held;`),
  "a-parameter-taken-apart": {
    declare: `function openN<T>({ held }: { held: T }): T {\n  return held;\n}`,
    call: `openN<W>({ held: V })`,
  },
  "a-default-of-a-parameter": {
    declare: `function passN<T>(value: T, other: T = value): T {\n  return other;\n}`,
    call: `passN<W>(V)`,
  },
  "a-closure": { declare: `function laterN<T>(value: T): () => T {\n  return () => value;\n}`, call: `laterN<W>(V)()` },
  "a-callback-it-is-handed-to": {
    declare: `function handN<T>(value: T, take: (value: T) => T): T {\n  return take(value);\n}`,
    call: `handN<W>(V, inner => inner)`,
  },
  "a-generator": {
    declare: `function* eachN<T>(value: T): Generator<T> {\n  yield value;\n}`,
    call: `[...eachN<W>(V)][0]`,
  },
  "a-step-of-a-generator": {
    declare: `function* eachN<T>(value: T): Generator<T, T> {\n  yield value;\n  return value;\n}`,
    call: `eachN<W>(V).next().value`,
  },
  "a-loop-over-a-list": throughBody(`for (const element of [value]) return element;\n  return value;`),
  "a-thrown-value": throughBody(`try {\n    throw value;\n  } catch (caught) {\n    return caught as T;\n  }`),
  "map": throughBody(`return [value].map((element: T): T => element)[0];`),
  "filter": throughBody(`return [value].filter((element: T) => true)[0];`),
  "reduce": throughBody(`return [value, value].reduce((last: T, element: T): T => element);`),
  "reduce-from-a-first-value": throughBody(`return [value].reduce<T>((last, element) => element, value);`),
  "for-each": throughBody(
    `let found!: T;\n  [value].forEach((element: T) => {\n    found = element;\n  });\n  return found;`,
  ),
  "find": throughBody(`return [value].find((element: T) => true)!;`),
  "find-last": throughBody(`return [value].findLast((element: T) => true)!;`),
  "sort": throughBody(`return [value, value].sort((first: T, second: T) => 0)[0];`),
  "flat-map": throughBody(`return [value].flatMap((element: T): T[] => [element])[0];`),
  "array-from-with-a-callback": throughBody(`return Array.from([value], (element: T): T => element)[0];`),
  "array-from-a-set": throughBody(`return Array.from(new Set<T>([value]))[0];`),
  "slice-concat-and-at": throughBody(`return [value].slice().concat([value]).at(-1)!;`),
  "for-each-of-a-map": throughBody(
    `let found!: T;\n  new Map<number, T>([[1, value]]).forEach((element: T) => {\n    found = element;\n  });\n  return found;`,
  ),
  "a-chain-of-array-methods": throughBody(
    `return [value, value]\n    .map((element: T): T => element)\n    .filter((element: T) => true)\n    .map((element: T): T => element)[1];`,
  ),
  "object-values": throughBody(`return Object.values<T>({ held: value })[0];`),
  "object-entries": throughBody(`return Object.fromEntries<T>(Object.entries<T>({ held: value })).held;`),
  "object-assign": throughBody(`return Object.assign({} as { held: T }, { held: value }).held;`),
  "reflect-apply": {
    declare: `function sameN<T>(value: T): T {\n  return value;\n}\nfunction passN<T>(value: T): T {\n  return Reflect.apply(sameN<T>, undefined, [value]);\n}`,
    call: `passN<W>(V)`,
  },
  "call-and-bind": {
    declare: `function sameN<T>(value: T): T {\n  return value;\n}\nfunction passN<T>(value: T): T {\n  return sameN.bind(undefined, sameN.call(undefined, value))() as T;\n}`,
    call: `passN<W>(V)`,
  },
  "a-resolved-promise": {
    declare: `async function passN<T>(value: T): Promise<T> {\n  return await Promise.resolve(value);\n}`,
    call: `await passN<W>(V)`,
    waits: true,
  },
  "then-of-a-promise": {
    declare: `function passN<T>(value: T): Promise<T> {\n  return Promise.resolve(value).then((inner: Awaited<T>) => inner as T);\n}`,
    call: `await passN<W>(V)`,
    waits: true,
  },
  "promise-all": {
    declare: `async function passN<T>(value: T): Promise<T> {\n  return (await Promise.all([value]))[0] as T;\n}`,
    call: `await passN<W>(V)`,
    waits: true,
  },
  "an-async-generator": {
    declare: `async function* eachN<T>(value: T): AsyncGenerator<T> {\n  yield value;\n}\nasync function passN<T>(value: T): Promise<T> {\n  for await (const element of eachN(value)) return element;\n  return value;\n}`,
    call: `await passN<W>(V)`,
    waits: true,
  },
  "parsed-text": {
    declare: `function parseN<T>(text: string): T {\n  return JSON.parse(text);\n}`,
    call: `parseN<W>(JSON.stringify(V))`,
    parses: true,
  },
};

// `X` reads the place. What may throw in plain Bun stands in a `try` of its own; the rest stands bare, in the function that holds the place.
const usesThatNeverThrow = [
  `tableN[X as any] += 1;\n  out.push(describe(Reflect.ownKeys(tableN).length));`,
  `listN[X as any] **= 2;\n  out.push(describe(listN.length));`,
  `out.push(describe(typeof X === "object" ? "an object" : X));`,
  `out.push(describe(typeof X === "number" ? (X as any) + 1 : typeof X === "string" ? (X as any).length : "neither"));`,
  `out.push(describe(X ?? "nothing"), describe(X || "falsy"), describe(X && "truthy"), describe(!X));`,
  `out.push(describe(X === null ? "null" : X === undefined ? "undefined" : X));`,
  `out.push(describe(X == null), describe((X as any) == 5), describe((X as any) === 5), describe((X as any) === "text"));`,
  `out.push(describe(X?.wantedN), describe((X as any)?.length), describe((X as any)?.otherN));`,
  `out.push(describe(X instanceof OtherN), describe(X instanceof FitsN), describe(Array.isArray(X)), describe(Object.is(X, X)));`,
  `switch (typeof X) {\n    case "number":\n      out.push("a number " + ((X as any) - 1));\n      break;\n    case "string":\n      out.push("a string " + (X as any).toUpperCase());\n      break;\n    case "object":\n      out.push(X === null ? "null" : "an object");\n      break;\n    default:\n      out.push(typeof X);\n  }`,
  `for (const key in X as any) out.push(key);`,
  `out.push(describe({ ...(X as any) }), describe([X]), describe({ held: X }));`,
  `out.push(describe([X, X].indexOf(X)), describe([X].includes(X)), describe(new Map([[X, 1]]).get(X)), describe(new Set([X]).has(X)));`,
  `out.push(describe(takeN(X)), describe(giveN(X)));`,
  `sinkN.held = X;\n  out.push(describe(sinkN.held), describe(typeof sinkN.held));`,
  `{\n    const local = X;\n    const chosen = typeof local === "object" ? "an object" : local;\n    out.push(describe(chosen), describe((chosen as any)?.length));\n  }`,
  `{\n    const local: any = X;\n    const chosen = typeof local === "object" || typeof local === "function" ? undefined : local;\n    out.push(describe(chosen), describe(typeof chosen));\n  }`,
];
const usesThatMayThrow = [
  `let counted: W = X;\n    let steps = 0;\n    for (; (counted as any)-- && steps < 3; ) steps++;\n    out.push(describe(steps), describe(counted));`,
  `let counted: W = X;\n    (counted as any)++;\n    out.push(describe(counted));`,
  `out.push(describe(\`<\${X}>\`));`,
  `out.push(describe((X as any) + 1));`,
  `out.push(describe((X as any) + "1"));`,
  `out.push(describe(X.wantedN));`,
  `out.push(describe((X as any).length));`,
  `out.push(describe(JSON.stringify(X)));`,
  `out.push(describe(String(X)));`,
  `out.push(describe((X as any) < 5), describe((X as any) >= 5));`,
  `const { wantedN } = X;\n    out.push(describe(wantedN));`,
  `const [first] = X as any;\n    out.push(describe(first));`,
  `out.push(describe((X as any)()));`,
  `out.push(describe(new (X as any)()));`,
  `out.push(describe("wantedN" in (X as any)));`,
  `out.push(describe(+(X as any)), describe(-(X as any)), describe(~(X as any)));`,
  `out.push(describe((X as any) | 0), describe((X as any) * 2), describe((X as any) % 3));`,
  `out.push(describe(Math.max(X as any, 1)), describe(Number(X)));`,
  `out.push(describe((X as any).toString()));`,
  `out.push(describe(Object.keys(X)));`,
  `out.push(describe("abc"[X as any]), describe([7, 8, 9][X as any]));`,
  `(X as any).wantedN = "stored";\n    out.push(describe(X.wantedN));`,
];

// What arrives, in turn. `N` as above.
const cases: Record<string, string[]> = {
  "another-class-then-whole-numbers": [`new OtherN()`, `1`, `2`, `0`],
  "another-class-then-a-fraction": [`new OtherN()`, `0.5`, `-0`, `(0 / 0)`],
  "another-class-then-texts": [`new OtherN()`, `"text"`, `""`, `"1"`],
  "another-class-then-nothing": [`new OtherN()`, `null`, `undefined`],
  "another-class-then-the-other-primitives": [`new OtherN()`, `true`, `false`, `10n`, `Symbol.iterator`],
  "another-class-then-the-counter-of-the-loop": [`new OtherN()`, `turn`, `turn`, `turn`],
  "a-list-then-the-counter-of-the-loop": [`[1, 2]`, `turn`, `turn`],
  "another-class-alone": [`new OtherN()`],
  "a-whole-number-alone": [`10`],
  "a-text-alone": [`"text"`],
  "numbers-and-texts": [`3`, `"text"`, `0.25`],
  "what-fits-then-a-whole-number": [`new FitsN()`, `7`],
  "what-fits-then-another-class-and-a-text": [`new FitsN()`, `new OtherN()`, `"text"`],
  "a-literal-that-fits-then-a-number": [`{ wantedN: "written" }`, `4`],
  "a-literal-of-another-shape-then-a-number": [`{ otherN: 2 }`, `4`],
  "a-list-then-a-number": [`[1, 2]`, `1`],
  "a-function-then-a-number": [`() => 1`, `1`],
  "a-proxy-then-a-number": [`new Proxy({}, {})`, `2`],
  "a-proxy-over-what-fits-then-a-text": [`new Proxy(new FitsN(), {})`, `"text"`],
};
const survivesText = (value: string) => !/Proxy|=>|undefined|Symbol|10n|0 \/ 0|-0/.test(value);

type Place = {
  /** `FIRST` is the first arrival, `NEXT` the arrival of this turn, `USES` the uses. `TURNS` is how often the loop runs. */
  text: string;
  read: string;
};
const loop = (store: string) => `for (let turn = 0; turn < TURNS; turn++) {\n  ${store}\n  USES\n}`;
const inFunction = (body: string) => `ASYNC function runN(out: string[]) {\n${body}\n}\nAWAIT runN(outN);`;
const places: Record<string, Place> = {
  "a-constant": { read: `held`, text: inFunction(loop(`const held: W = NEXT;`)) },
  "a-variable": { read: `held`, text: inFunction(`let held: W = FIRST;\n` + loop(`held = NEXT;`)) },
  "a-variable-that-a-closure-reads": {
    read: `held`,
    text: inFunction(
      `let held: W = FIRST;\nconst read = () => held;\n` + loop(`held = NEXT;`) + `\nout.push(describe(read()));`,
    ),
  },
  "a-variable-that-a-closure-stores-to": {
    read: `held`,
    text: inFunction(
      `let held: W = FIRST;\nconst store = (value: W) => {\n  held = value;\n};\n` + loop(`store(NEXT);`),
    ),
  },
  "a-variable-of-the-module": {
    read: `heldN`,
    text:
      `let heldN: W = FIRST;\nconst readN = () => heldN;\n{\nconst out = outN;\n` +
      loop(`heldN = NEXT;`) +
      `\nout.push(describe(readN()));\n}`,
  },
  "a-variable-of-the-module-read-in-a-function": {
    read: `heldN`,
    text: `let heldN: W = FIRST;\n` + inFunction(loop(`heldN = NEXT;`)),
  },
  "a-field-of-an-instance": {
    read: `holder.held`,
    text:
      `class HolderN {\n  held: W = FIRST;\n}\n` +
      inFunction(`const holder = new HolderN();\n` + loop(`holder.held = NEXT;`)),
  },
  "a-property-of-a-literal": {
    read: `holder.held`,
    text: inFunction(`const holder: { held: W } = { held: FIRST };\n` + loop(`holder.held = NEXT;`)),
  },
  "an-element-of-a-list": {
    read: `kept[0]`,
    text: inFunction(`const kept: W[] = [FIRST];\n` + loop(`kept[0] = NEXT;`)),
  },
  "a-parameter": {
    read: `held`,
    text:
      `function useN(held: W, out: string[]) {\n  USES\n}\n` +
      inFunction(`for (let turn = 0; turn < TURNS; turn++) useN(NEXT, out);`),
  },
};

const strangers = [...new Set(Object.values(cases).flat())];
const isShared = (place: string) => /closure|module/.test(place);

function writeScene(random: Random, number: number): string {
  const road = roads[random.pick(Object.keys(roads))];
  const place =
    places[
      random.pick(
        Object.keys(places).filter(
          name => (!road.waits || name !== "a-field-of-an-instance") && (isShared(name) || random.chance(0.4)),
        ),
      )
    ];
  let arrivals = random.chance(0.6)
    ? random.pick(Object.values(cases))
    : Array.from({ length: random.between(1, 4) }, () => random.pick(strangers));
  if (road.parses) arrivals = arrivals.filter(survivesText);
  if (!arrivals.length) arrivals = [`new OtherN()`, `1`];
  const call = (value: string) => road.call.replaceAll("V", `((${value}) as any)`);
  const next = arrivals
    .map((value, index) =>
      index === arrivals.length - 1 ? call(value) : `turn % ${arrivals.length} === ${index} ? ${call(value)} : `,
    )
    .join("");
  const share = random.pick([0.1, 0.3, 0.6, 0.9]);
  const uses = random
    .shuffled([
      ...usesThatNeverThrow,
      ...usesThatMayThrow.map(use => `try {\n    ${use}\n  } catch (error) {\n    out.push(classOf(error));\n  }`),
    ])
    .filter((use, index) => index === 0 || random.chance(/ (\+|\*\*)= |instanceof/.test(use) ? 0.7 : share))
    .join("\n  ");
  return [
    `interface WantedN {\n  wantedN: string;\n}\nclass FitsN implements WantedN {\n  wantedN = "fits";\n}\nclass OtherN {\n  otherN = 1;\n}`,
    road.declare,
    `const outN: string[] = [];\nconst tableN: any = {};\nconst listN: any = [];\nconst sinkN: { held: WantedN | null } = { held: null };`,
    `function takeN(value: WantedN): unknown {\n  return value?.wantedN;\n}\nfunction giveN(value: WantedN): WantedN {\n  return value;\n}`,
    place.text
      .replaceAll("USES", uses.replaceAll("X", place.read))
      .replaceAll("FIRST", call(arrivals[0] === "turn" ? "0" : arrivals[0]))
      .replaceAll("NEXT", next)
      .replaceAll("TURNS", String(arrivals.length * random.pick([1, 2, 2, 40])))
      .replaceAll("ASYNC ", road.waits ? "async " : "")
      .replaceAll("AWAIT ", road.waits ? "await " : ""),
    `console.log(outN.join(" | "));`,
  ]
    .filter(part => part !== "")
    .join("\n")
    .replaceAll(/\bW\b/g, "WantedN")
    .replaceAll(/(?<=[a-z])N\b/g, String(number));
}

export function generate(random: Random): string {
  const scenes = Array.from({ length: random.between(1, 3) }, (_, index) => writeScene(random, index + 1));
  return head + scenes.join("\n") + "\nexport {};\n";
}
