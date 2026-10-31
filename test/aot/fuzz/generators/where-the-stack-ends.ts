// bun where-the-stack-ends.ts <folder> [--count=<programs>] [--seed=<number>] [--cases=<cases in a program>] writes <folder>/<n>.ts
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

interface Road {
  name: string;
  recurse(id: number): string;
  beside?(id: number): string;
}

const road = (name: string, recurse: (id: number) => string, beside?: (id: number) => string): Road => ({ name, recurse, beside });
const callbackOf = (name: string, call: (callback: string) => string) => road(name, id => call(`each => down${id}(each)`));

const roads: Road[] = [
  road("a-call", id => `down${id}(level + 1)`),
  road(
    "two-functions",
    id => `other${id}(level + 1)`,
    id => `function other${id}(level: number): number {\n  const kept = [level, level];\n  return down${id}(level) + kept[0] - kept[1];\n}`,
  ),
  road(
    "three-functions-of-three-sizes",
    id => `small${id}(level + 1)`,
    id =>
      `function small${id}(level: number): number {\n  return large${id}(level);\n}\nfunction large${id}(level: number): number {\n  const a = level + 1, b = level + 2, c = level + 3, d = level + 4, e = level / 2, f = level / 3, g = "g" + level, h = [level], i = { level };\n  return down${id}(level) + a + b + c + d - 4 * level - 10 + e * 2 - level + f * 0 + g.length - g.length + h[0] - i.level;\n}`,
  ),
  road(
    "a-method",
    id => `walker${id}.step(level + 1)`,
    id => `class Walker${id} {\n  constructor(public depth: number) {}\n  step(level: number): number {\n    return down${id}(level) + this.depth - this.depth;\n  }\n}\nconst walker${id} = new Walker${id}(1);`,
  ),
  road(
    "a-method-of-a-new-instance",
    id => `new Walker${id}(level).step(level + 1)`,
    id => `class Walker${id} {\n  constructor(public depth: number) {}\n  step(level: number): number {\n    return down${id}(level) + this.depth - this.depth;\n  }\n}`,
  ),
  road(
    "a-method-of-the-parent",
    id => `child${id}.step(level + 1)`,
    id => `class Parent${id} {\n  step(level: number): number {\n    return down${id}(level);\n  }\n}\nclass Child${id} extends Parent${id} {\n  step(level: number): number {\n    return super.step(level);\n  }\n}\nconst child${id} = new Child${id}();`,
  ),
  road("a-closure", id => `(() => down${id}(level + 1))()`),
  road("a-closure-out-of-an-array", id => `[() => down${id}(level + 1)][0]()`),
  callbackOf("map", callback => `[level + 1].map(${callback})[0]`),
  callbackOf("flat-map", callback => `[level + 1].flatMap(${callback})[0]`),
  callbackOf("array-from", callback => `Array.from([level + 1], ${callback})[0]`),
  callbackOf("map-of-floats", callback => `new Float64Array([level + 1]).map(${callback})[0]`),
  road("reduce", id => `[level + 1].reduce((sum, each) => sum + down${id}(each), 0)`),
  road("find", id => `Number([level + 1].find(each => down${id}(each) !== 0) ?? 0)`),
  road("some", id => `Number([level + 1].some(each => down${id}(each) !== 0))`),
  road(
    "for-each",
    id => `sumOf${id}([level + 1])`,
    id => `function sumOf${id}(list: number[]) {\n  let sum = 0;\n  list.forEach(each => {\n    sum += down${id}(each);\n  });\n  return sum;\n}`,
  ),
  road(
    "for-each-of-a-map",
    id => `sumOf${id}(new Map([[level + 1, 0]]))`,
    id => `function sumOf${id}(map: Map<number, number>) {\n  let sum = 0;\n  map.forEach((_, key) => {\n    sum += down${id}(key);\n  });\n  return sum;\n}`,
  ),
  road("a-comparator", id => `[level + 1, 0].sort((a, b) => down${id}(Math.max(a, b)))[0] * 0`),
  road(
    "a-getter",
    id => `((chain${id}.at = level + 1), chain${id}.next)`,
    id => `const chain${id} = {\n  at: 0,\n  get next(): number {\n    return down${id}(this.at);\n  },\n};`,
  ),
  road(
    "a-setter",
    id => `((sink${id}.next = level + 1), sink${id}.got)`,
    id => `const sink${id} = {\n  got: 0,\n  set next(level: number) {\n    this.got = down${id}(level);\n  },\n};`,
  ),
  road(
    "a-get-trap",
    id => `trapped${id}[level + 1]`,
    id => `const trapped${id} = new Proxy({} as Record<string, number>, { get: (_, name) => down${id}(Number(name)) });`,
  ),
  road(
    "an-apply-trap",
    id => `called${id}(level + 1)`,
    id => `const called${id} = new Proxy((_: number) => 0, { apply: (_target, _self, [level]) => down${id}(level) });`,
  ),
  road("a-has-trap", id => `Number("k" in new Proxy({}, { has: () => down${id}(level + 1) !== 0 }))`),
  road("an-own-keys-trap", id => `Object.keys(new Proxy({}, { ownKeys: () => (down${id}(level + 1), []) })).length`),
  road("value-of", id => `Number({ valueOf: () => down${id}(level + 1) })`),
  road("to-primitive", id => `Number({ [Symbol.toPrimitive]: () => down${id}(level + 1) })`),
  road("to-string-in-a-template", id => "`${{ toString: () => String(down" + id + "(level + 1)) }}`.length - 1"),
  road("to-string-in-a-join", id => `Number([{ toString: () => String(down${id}(level + 1)) }].join())`),
  road("to-json", id => `JSON.stringify({ toJSON: () => down${id}(level + 1) }).length - 1`),
  road("a-getter-read-by-stringify", id => `JSON.stringify({ get below() { return down${id}(level + 1); } }).length - 11`),
  road("a-reviver", id => `JSON.parse("0", () => down${id}(level + 1))`),
  road("a-getter-read-by-a-spread", id => `({ ...{ get below() { return down${id}(level + 1); } } }).below`),
  road("a-getter-read-by-assign", id => `Object.assign({ below: 1 }, { get below() { return down${id}(level + 1); } }).below`),
  road(
    "a-constructor",
    id => `new Knot${id}(level + 1).below`,
    id => `class Knot${id} {\n  below: number;\n  constructor(level: number) {\n    this.below = down${id}(level);\n  }\n}`,
  ),
  road(
    "a-constructor-of-the-parent",
    id => `new Lower${id}(level + 1).below`,
    id => `class Upper${id} {\n  below: number;\n  constructor(level: number) {\n    this.below = down${id}(level);\n  }\n}\nclass Lower${id} extends Upper${id} {\n  more = 1;\n  constructor(level: number) {\n    super(level);\n  }\n}`,
  ),
  road(
    "a-field-initializer",
    id => `((Field${id}.at = level + 1), new Field${id}().below)`,
    id => `class Field${id} {\n  static at = 0;\n  below = down${id}(Field${id}.at);\n}`,
  ),
  road(
    "a-static-block",
    id => `inStaticBlock${id}(level + 1)`,
    id => `function inStaticBlock${id}(level: number) {\n  let below = 0;\n  class Local {\n    static {\n      below = down${id}(level);\n    }\n  }\n  void Local;\n  return below;\n}`,
  ),
  road("a-computed-key", id => `({ [String(down${id}(level + 1))]: 0 })["0"]`),
  road("reflect-apply", id => `Reflect.apply(down${id}, undefined, [level + 1])`),
  road("reflect-construct", id => `(Reflect.construct(function (this: { below: number }, level: number) { this.below = down${id}(level); } as any, [level + 1]) as { below: number }).below`),
  road("function-call", id => `down${id}.call(undefined, level + 1)`),
  road("function-apply", id => `down${id}.apply(undefined, [level + 1])`),
  road("a-new-bound-function", id => `down${id}.bind(undefined)(level + 1)`),
  road("a-bound-function-with-an-argument", id => `down${id}.bind(undefined, level + 1)()`),
  road(
    "a-generator",
    id => `[...yields${id}(level + 1)][0]`,
    id => `function* yields${id}(level: number): Generator<number> {\n  yield down${id}(level);\n}`,
  ),
  road(
    "a-generator-stepped-by-hand",
    id => `yields${id}(level + 1).next().value`,
    id => `function* yields${id}(level: number): Generator<number, number> {\n  const kept = { level };\n  yield down${id}(kept.level);\n  return 0;\n}`,
  ),
  road(
    "an-iterator",
    id => `[...once${id}(level + 1)][0]`,
    id =>
      `function once${id}(level: number): Iterable<number> {\n  return {\n    [Symbol.iterator]() {\n      let isDone = false;\n      return {\n        next() {\n          if (isDone) return { done: true as const, value: 0 };\n          isDone = true;\n          return { done: false as const, value: down${id}(level) };\n        },\n      };\n    },\n  };\n}`,
  ),
  road("a-callback-of-replace", id => `Number("x".replace("x", () => String(down${id}(level + 1))))`),
  road("a-callback-of-replace-with-a-pattern", id => `Number("x".replace(/x/g, () => String(down${id}(level + 1))))`),
  road(
    "a-tag",
    id => "tag" + id + "`${level + 1}`",
    id => `function tag${id}(_: TemplateStringsArray, level: number) {\n  return down${id}(level);\n}`,
  ),
  road(
    "a-default-of-a-parameter",
    id => `withDefault${id}(level + 1)`,
    id => `function withDefault${id}(level: number, below = down${id}(level)) {\n  return below;\n}`,
  ),
  road("a-default-in-a-pattern", id => `(({ below = down${id}(level + 1) }: { below?: number }) => below)({})`),
  road(
    "has-instance",
    id => `((judge${id}.at = level + 1), Number({} instanceof (judge${id} as any)))`,
    id => `const judge${id} = {\n  at: 0,\n  [Symbol.hasInstance](): boolean {\n    return down${id}(this.at) !== 0;\n  },\n};`,
  ),
  road(
    "an-executor",
    id => `inExecutor${id}(level + 1)`,
    id =>
      `function inExecutor${id}(level: number) {\n  let below = 0;\n  let thrown: unknown;\n  let hasThrown = false;\n  new Promise<void>(() => {\n    try {\n      below = down${id}(level);\n    } catch (error) {\n      hasThrown = true;\n      thrown = error;\n    }\n  });\n  if (hasThrown) throw thrown;\n  return below;\n}`,
  ),
  road(
    "an-async-function",
    id => `(starts${id}(level + 1).catch(nothing), 0)`,
    id => `async function starts${id}(level: number) {\n  return down${id}(level);\n}`,
  ),
  road(
    "finally",
    id => `inFinally${id}(level + 1)`,
    id => `function inFinally${id}(level: number) {\n  let below = 0;\n  try {\n    below = 1;\n  } finally {\n    below = down${id}(level);\n  }\n  return below;\n}`,
  ),
  road(
    "catch",
    id => `inCatch${id}(level + 1)`,
    id => `function inCatch${id}(level: number) {\n  try {\n    throw level;\n  } catch (thrown) {\n    return down${id}(thrown as number);\n  }\n}`,
  ),
  road(
    "many-parameters",
    id => `wide${id}(level + 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12.5, "n")`,
    id =>
      `function wide${id}(level: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: string) {\n  return down${id}(level) + a + b + c + d + e + f + g + h + i + j + k - 66 + l - 12.5 + m.length - 1;\n}`,
  ),
  road(
    "a-spread-of-two-hundred",
    id => `spreadInto${id}(level + 1, ...filler${id})`,
    id => `const filler${id} = Array.from({ length: 200 }, (_, at) => at);\nfunction spreadInto${id}(level: number, ...rest: number[]) {\n  return down${id}(level) + rest.length - 200;\n}`,
  ),
  road(
    "apply-with-twenty-thousand",
    id => `((filler${id}[0] = level + 1), spreadInto${id}.apply(undefined, filler${id}))`,
    id => `const filler${id} = Array.from({ length: 20000 }, () => 1);\nfunction spreadInto${id}(...all: number[]) {\n  return down${id}(all[0]) + all.length - 20000;\n}`,
  ),
  road(
    "the-arguments-object",
    id => `throughArguments${id}(level + 1, 2, 3)`,
    id => `function throughArguments${id}(_a: number, _b: number, _c: number) {\n  return down${id}(arguments[0]) + arguments.length - 3;\n}`,
  ),
];

const frames: { name: string; before: string; after: string }[] = [
  { name: "nothing", before: ``, after: `0` },
  {
    name: "numbers",
    before: `const a = level | 0, b = level / 3, c = level * 2, d = level + 0.5, e = level ^ 5, f = level % 7, g = level - 1, h = level * 1.5;`,
    after: `a + c + e + f + g - (level | 0) - level * 2 - (level ^ 5) - (level % 7) - (level - 1) + (b - level / 3) + (d - level - 0.5) + (h - level * 1.5)`,
  },
  { name: "an-object", before: `const box = { level, list: [level, level + 1], text: "t" };`, after: `box.level - level + box.list[1] - level - 1 + box.text.length - 1` },
  { name: "nested-objects", before: `const box = { inner: { level, deeper: { level } }, other: { ...{ level } } };`, after: `box.inner.level + box.inner.deeper.level - box.other.level - level` },
  { name: "a-long-array", before: `const table = [level, ${Array.from({ length: 63 }, (_, at) => at + 1).join(", ")}];`, after: `table[0] - level + table[63] - 63` },
  { name: "a-text-put-together", before: `let text = "";\nfor (let at = 0; at < 3; at++) text += level;`, after: `text.length - String(level).length * 3` },
  { name: "a-closure", before: `let count = level;\nconst bump = () => ++count;`, after: `bump() - level - 1` },
  {
    name: "patterns",
    before: `const [first, ...others] = [level, level + 1, level + 2];\nconst { x, ...more } = { x: level, y: 1, z: 2 };`,
    after: `first - level + others.length - 2 + x - level + more.z - 2`,
  },
  { name: "a-map", before: `const seen = new Map([[level, level]]);`, after: `seen.get(level)! - level` },
  { name: "a-bigint", before: `const huge = BigInt(level) << 70n;`, after: `Number(huge >> 70n) - level` },
  { name: "one-of-two-kinds", before: `const either: number | { level: number } = level % 2 ? level : { level };`, after: `(typeof either === "number" ? either : either.level) - level` },
];

const guards: { name: string; text(recurse: string, id: number): string }[] = [
  { name: "no-handler", text: recurse => `const below: number = ${recurse};` },
  { name: "caught-and-thrown-on", text: (recurse, id) => `let below = 0;\ntry {\n  below = ${recurse};\n} catch (error) {\n  atTheEnd${id}();\n  throw error;\n}` },
  { name: "caught", text: (recurse, id) => `let below = 0;\ntry {\n  below = ${recurse};\n} catch (error) {\n  atTheEnd${id}();\n  if (!(error instanceof RangeError)) throw error;\n}` },
  {
    name: "caught-at-every-64th",
    text: (recurse, id) => `let below = 0;\nif (level % 64) below = ${recurse};\nelse\n  try {\n    below = ${recurse};\n  } catch (error) {\n    atTheEnd${id}();\n    if (!(error instanceof RangeError)) throw error;\n  }`,
  },
  { name: "counted-in-finally", text: (recurse, id) => `let below = 0;\nentered${id}++;\ntry {\n  below = ${recurse};\n} finally {\n  left${id}++;\n}` },
  { name: "counted-in-catch", text: (recurse, id) => `let below = 0;\nentered${id}++;\ntry {\n  below = ${recurse};\n  left${id}++;\n} catch (error) {\n  left${id}++;\n  throw error;\n}` },
  { name: "a-call-in-finally", text: (recurse, id) => `let below = 0;\nentered${id}++;\ntry {\n  below = ${recurse};\n} finally {\n  left${id}++;\n  atTheEnd${id}();\n}` },
];

const probes: { name: string; text: string }[] = [
  { name: "nothing", text: `0` },
  { name: "stringify", text: `JSON.stringify({ a: [1, { b: 2 }] })` },
  { name: "parse", text: `JSON.parse('{"a":[1,{"b":2}]}').a.length` },
  { name: "sort", text: `[3, 1, 2].sort((a, b) => a - b).join()` },
  { name: "replace", text: `"aaa".replace(/a/g, each => each + "b")` },
  { name: "a-pattern-that-goes-back", text: `/(a+)+b/.test("aaaaaaaaaaaac")` },
  { name: "a-new-pattern", text: `new RegExp("(x|y)+z", "i").test("xyxyZ")` },
  { name: "the-stack-of-an-error", text: `typeof new Error("x").stack` },
  { name: "a-type-error", text: `(() => {\n  try {\n    return (null as any).x;\n  } catch (error) {\n    return (error as Error).name;\n  }\n})()` },
  { name: "a-template", text: "`${{ toString: () => \"t\" }}|${1.5}|${[1, 2]}`" },
  { name: "flat", text: `[1, [2, [3, [4]]]].flat(Infinity).length` },
  { name: "structured-clone", text: `structuredClone({ a: [1, 2], b: new Map([[1, 2]]) }).a.length` },
  { name: "a-map", text: `new Map([[1, 2]]).get(1)` },
  { name: "array-from", text: `Array.from({ length: 3 }, (_, at) => at * 2).join()` },
  { name: "entries", text: `Object.entries({ a: 1, b: 2 }).length` },
  { name: "a-bigint", text: `(2n ** 200n).toString().length` },
  { name: "to-fixed", text: `(1234.5678).toFixed(2)` },
  { name: "a-number-format", text: `new Intl.NumberFormat("en-US").format(1234.5)` },
  { name: "a-date-format", text: `new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(new Date(0))` },
  { name: "locale-compare", text: `"a".localeCompare("b")` },
  { name: "normalize", text: `"e\\u0301".normalize("NFC").length` },
  { name: "encode", text: `encodeURIComponent("é ü")` },
  { name: "bytes", text: `new Uint8Array(8).fill(1).join("")` },
  { name: "a-proxy", text: `new Proxy({ a: 1 }, {}).a` },
  { name: "own-keys", text: `Reflect.ownKeys({ a: 1, [Symbol.iterator]: 2 }).length` },
  { name: "a-new-class", text: `new (class {\n  x = 1;\n  #y = 2;\n  sum() {\n    return this.x + this.#y;\n  }\n})().sum()` },
  { name: "a-generator", text: `(function* () {\n  yield 1;\n})().next().value` },
  { name: "an-async-function", text: `typeof (async () => {\n  await 0;\n})().then(nothing)` },
  { name: "a-spread-call", text: `Math.max(...[1, 2, 3])` },
  { name: "a-set", text: `[...new Set([1, 1, 2])].length` },
  { name: "a-date", text: `new Date(0).toISOString()` },
  { name: "a-url", text: `new URL("http://a.example/b?c=d").searchParams.get("c")` },
  { name: "an-encoder", text: `new TextEncoder().encode("héllo").length` },
  { name: "a-decoder", text: `new TextDecoder().decode(new Uint8Array([104, 105]))` },
  { name: "a-buffer", text: `Buffer.from("hi").toString("hex")` },
  { name: "headers", text: `new Headers({ a: "b" }).get("a")` },
  { name: "a-request", text: `new Request("http://a.example/", { method: "POST", body: "x" }).method` },
  { name: "a-response", text: `new Response("x", { status: 201 }).status` },
  { name: "a-blob", text: `new Blob(["ab"]).size` },
  { name: "an-abort-controller", text: `new AbortController().signal.aborted` },
  { name: "an-event-target", text: `new EventTarget().dispatchEvent(new Event("x"))` },
  { name: "the-clock", text: `typeof performance.now()` },
  { name: "a-random-id", text: `crypto.randomUUID().length` },
  { name: "base64", text: `atob(btoa("hello"))` },
  { name: "a-collection", text: `(Bun.gc(true), "collected")` },
  { name: "a-timer", text: `(clearTimeout(setTimeout(nothing, 0)), "timer")` },
  { name: "a-job", text: `(queueMicrotask(nothing), "job")` },
  { name: "a-weak-reference", text: `typeof new WeakRef({}).deref()` },
  { name: "path", text: `require("node:path").join("a", "..", "b")` },
  { name: "format", text: `require("node:util").format("%s-%d-%j", "a", 1, { b: 2 })` },
  { name: "inspect", text: `require("node:util").inspect({ a: [1, { b: new Map([[1, 2]]) }] })` },
  { name: "an-emitter", text: `new (require("node:events"))().listenerCount("x")` },
  { name: "query-string", text: `require("node:querystring").stringify({ a: [1, 2], b: "c d" })` },
  { name: "assert", text: `typeof require("node:assert").deepStrictEqual({ a: [1] }, { a: [1] })` },
  { name: "deflate", text: `require("node:zlib").inflateSync(require("node:zlib").deflateSync("aaaa")).toString()` },
  { name: "a-hash", text: `require("node:crypto").createHash("sha1").update("a").digest("hex")` },
  { name: "the-file-system", text: `require("node:fs").existsSync("/no/such/path")` },
  { name: "a-stream", text: `require("node:stream").Readable.from(["a"]).readable` },
  { name: "a-string-decoder", text: `new (require("node:string_decoder").StringDecoder)("utf8").write(Buffer.from("hi"))` },
  { name: "async-local-storage", text: `new (require("node:async_hooks").AsyncLocalStorage)().run(5, () => 5)` },
];

const contexts: { name: string; text(run: string): string }[] = [
  { name: "at-the-top", text: run => `console.log(${run});` },
  { name: "behind-an-await", text: run => `await null;\nconsole.log(${run});` },
  { name: "in-a-timer", text: run => `await new Promise<void>(resolve =>\n  setTimeout(() => {\n    console.log(${run});\n    resolve();\n  }, 0),\n);` },
  { name: "in-a-job", text: run => `await new Promise<void>(resolve =>\n  queueMicrotask(() => {\n    console.log(${run});\n    resolve();\n  }),\n);` },
  { name: "in-a-comparator", text: run => `{\n  let line = "";\n  [1, 2].sort(() => {\n    line ||= ${run};\n    return 0;\n  });\n  console.log(line);\n}` },
  { name: "in-a-generator", text: run => `console.log(\n  [\n    ...(function* () {\n      yield ${run};\n    })(),\n  ][0],\n);` },
  { name: "in-a-then", text: run => `await Promise.resolve().then(() => console.log(${run}));` },
];

export interface Combination {
  road: Road;
  frame: (typeof frames)[number];
  guard: (typeof guards)[number];
  probe: (typeof probes)[number];
  context: (typeof contexts)[number];
}

export const pickCombination = (pick: <T>(items: readonly T[]) => T): Combination => ({ road: pick(roads), frame: pick(frames), guard: pick(guards), probe: pick(probes), context: pick(contexts) });

export const nameOf = ({ road, frame, guard, probe, context }: Combination) => [road.name, frame.name, guard.name, probe.name, context.name].join("--");

const head = `declare const Bun: { gc(isFull: boolean): void };
declare const Buffer: { from(text: string): { toString(encoding?: string): string } };
declare const process: { on(event: string, run: () => void): void };
declare function require(name: string): any;
const limit = 4000000;
const budget = 12000000;
const strange: string[] = [];
function nothing() {}
process.on("unhandledRejection", nothing);
`;

const indented = (text: string, by = "  ") => text.split("\n").map(line => (line ? by + line : line)).join("\n"); // prettier-ignore

function caseOf(combination: Combination, id: number) {
  const { road, frame, guard, probe, context } = combination;
  return [
    `// ${id}: ${nameOf(combination)}`,
    `let calls${id} = 0;\nlet entered${id} = 0;\nlet left${id} = 0;\nlet probes${id} = 0;`,
    `function probe${id}() {\n  return ${indented(probe.text).trimStart()};\n}`,
    `function atTheEnd${id}() {\n  if (probes${id} >= 12) return;\n  probes${id}++;\n  try {\n    probe${id}();\n  } catch (error) {\n    if (!(error instanceof RangeError)) strange.push("${id} " + String(error));\n  }\n}`,
    road.beside?.(id) ?? "",
    `function down${id}(level: number): number {\n  if (level >= limit || ++calls${id} >= budget) return 0;\n${[frame.before, guard.text(road.recurse(id), id)].filter(Boolean).map(text => indented(text)).join("\n")}\n  return below + ${frame.after};\n}`, // prettier-ignore
    `function run${id}() {\n  let line = "${id}";\n  for (let round = 0; round < 3; round++) {\n    calls${id} = 0;\n    probes${id} = 0;\n    try {\n      const result = down${id}(0);\n      line += result === 0 ? " fine" : " result " + result;\n    } catch (error) {\n      line += error instanceof RangeError ? " fine" : " thrown " + String(error);\n    }\n  }\n  return line + " " + (entered${id} - left${id}) + " " + String(probe${id}());\n}`,
    context.text(`run${id}()`),
  ]
    .filter(Boolean)
    .join("\n");
}

export function programOf(combinations: Combination[]) {
  return `${head}${combinations.map((each, at) => caseOf(each, at + 1)).join("\n")}\nawait new Promise(resolve => setTimeout(resolve, 5));\nconsole.log(strange.join("\\n"));\n`;
}

export const tsconfig = JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, strict: true, types: [] } });

export function testPrograms() {
  const cases: Combination[] = [];
  for (let at = 0; at < probes.length; at++) cases.push({ road: roads[at % roads.length], frame: frames[at % frames.length], guard: guards[(at + (at >> 3)) % guards.length], probe: probes[(at * 7) % probes.length], context: contexts[at % contexts.length] }); // prettier-ignore
  const programs: { name: string; text: string }[] = [];
  for (let at = 0; at < cases.length; at += 3) programs.push({ name: cases.slice(at, at + 3).map(each => `${each.road.name} with ${each.guard.name} and ${each.probe.name}`).join(", "), text: programOf(cases.slice(at, at + 3)) }); // prettier-ignore
  return programs;
}

if (import.meta.main) {
  const option = (name: string) => process.argv.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
  const folder = process.argv[2];
  mkdirSync(folder, { recursive: true });
  let state = Number(option("seed") ?? 1);
  const pick = <T>(items: readonly T[]) => items[((state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 8) % items.length];
  for (let at = 0; at < Number(option("count") ?? 20); at++) writeFileSync(join(folder, `${at}.ts`), programOf(Array.from({ length: Number(option("cases") ?? 3) }, () => pickCombination(pick)))); // prettier-ignore
}
