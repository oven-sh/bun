// Small programs about one call that throws, made inside a function of the program that a built-in calls, and a handler round the built-in. What is thrown passes through the built-in and arrives at
// the handler as it would from a call written there. There is one scene, no helper, and every line is printed at once, by `console.log` itself.
//
//   what throws   functions of the host: `atob`, `btoa`, `structuredClone`, `URL`, `Buffer`, `TextDecoder`, `crypto.getRandomValues`, `AbortSignal`, `Headers`, `Request`, `Response`, `Blob`,
//                 `performance.measure`, `queueMicrotask`, `EventTarget`, `MessageChannel`, `WebSocket`, `process.chdir`, `node:fs`, `require`; functions of the language: `JSON.parse`,
//                 `normalize`, `repeat`, `toFixed`, `Intl`, `new Array`, `BigInt`, `decodeURIComponent`; operators; `throw` with an error, a `DOMException`, a text, `null`
//   who calls     getters, setters, `valueOf`, `toString`, `toJSON`, `Symbol.toPrimitive`, iterators and their `return`, `then`, traps of a proxy, callbacks of the methods of lists, typed arrays,
//                 maps, sets and texts, comparators, mappers, replacers, revivers, executors, `Reflect.apply`, `call`, `apply`, bound functions, tags, `Symbol.hasInstance`, `using`
//   the handler   round the built-in, in the caller, in the function itself, a `finally` on the way; once or three times
//   then          the class, the name and the code of what arrived, whether it is a `DOMException` or an `Error`, whether it has a stack
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const throws = random.weighted<string>([
    [4, 'atob("***")'],
    [2, 'btoa("\\u0100")'],
    [4, "structuredClone(() => {})"],
    [2, "structuredClone(Symbol())"],
    [1, "structuredClone(new WeakMap())"],
    [2, "crypto.getRandomValues(new Uint8Array(70000))"],
    [2, "AbortSignal.abort().throwIfAborted()"],
    [1, 'AbortSignal.abort("a reason").throwIfAborted()'],
    [2, 'performance.measure("m", "no such mark")'],
    [1, "new MessageChannel().port1.postMessage(() => {})"],
    [1, 'new WebSocket("nope")'],
    [1, 'new DOMException("made", "DataCloneError").nothing.here'],
    [2, 'new URL("nope")'],
    [1, "Buffer.alloc(-1)"],
    [1, 'Buffer.from("x", "nope")'],
    [1, 'new TextDecoder("nope")'],
    [1, 'new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([255]))'],
    [1, 'new Headers({ "bad name": "x" })'],
    [1, 'new Request("nope")'],
    [1, "new Response(null, { status: 1 })"],
    [1, "queueMicrotask(1)"],
    [1, "new EventTarget().dispatchEvent(1)"],
    [1, 'process.chdir("/no/such/folder")'],
    [1, 'process.getBuiltinModule("node:fs").readFileSync("/no/such/file")'],
    [1, 'JSON.parse("{")'],
    [1, '"a".normalize("x")'],
    [1, '"a".repeat(-1)'],
    [1, "(1).toFixed(101)"],
    [1, 'new Intl.NumberFormat("not a locale")'],
    [1, "new Array(-1)"],
    [1, "BigInt(1.5)"],
    [1, 'decodeURIComponent("%")'],
    [1, "null.x"],
    [1, "undefined()"],
    [1, "1n + 1"],
    [1, "nobodyDeclaresThis"],
  ]);
  const thrower = random.weighted([
    [10, `return ${throws};`],
    [2, `${throws};\nreturn 0;`],
    [1, `const unused = ${throws};\nreturn 0;`],
    [1, 'throw new DOMException("thrown by the program", "AbortError");'],
    [1, 'throw new RangeError("thrown by the program");'],
    [1, 'throw "a text";'],
    [1, "throw null;"],
  ]);
  const handlesItself = random.chance(0.12);
  const B = handlesItself
    ? `try {\n${thrower}\n} catch (error) {\nconsole.log("inside", error?.constructor?.name ?? String(error));\nthrow error;\n}`
    : random.chance(0.1)
      ? `try {\n${thrower}\n} finally {\nconsole.log("on the way");\n}`
      : thrower;

  const callers: [number, string][] = [
    [3, `Object.assign({}, {\nget value() {\n${B}\n},\n});`],
    [2, `Object.assign(\n{\nset value(given) {\n${B}\n},\n},\n{ value: 1 },\n);`],
    [2, `Object.defineProperty({}, "k", {\nget value() {\n${B}\n},\n});`],
    [1, `Object.defineProperties({}, {\nk: {\nget value() {\n${B}\n},\n},\n});`],
    [1, `Object.entries({\nget value() {\n${B}\n},\n});`],
    [1, `Object.values({\nget value() {\n${B}\n},\n});`],
    [1, `({\n...{\nget value() {\n${B}\n},\n},\n});`],
    [1, `structuredClone({\nget value() {\n${B}\n},\n});`],
    [1, `Object.fromEntries({\n*[Symbol.iterator]() {\n${B}\n},\n});`],
    [3, `JSON.stringify({\ntoJSON() {\n${B}\n},\n});`],
    [2, `JSON.stringify({\nget value() {\n${B}\n},\n});`],
    [2, `JSON.stringify({ k: 1 }, () => {\n${B}\n});`],
    [2, `JSON.parse("[1]", () => {\n${B}\n});`],
    [3, `Math.max({\nvalueOf() {\n${B}\n},\n});`],
    [1, `Number({\nvalueOf() {\n${B}\n},\n});`],
    [1, `new Date({\nvalueOf() {\n${B}\n},\n});`],
    [1, `[1, 2].at({\nvalueOf() {\n${B}\n},\n});`],
    [1, `"xy".slice({\nvalueOf() {\n${B}\n},\n});`],
    [2, `String({\ntoString() {\n${B}\n},\n});`],
    [1, `[\n{\ntoString() {\n${B}\n},\n},\n].join();`],
    [1, `"k".includes({\ntoString() {\n${B}\n},\n});`],
    [1, `new RegExp({\ntoString() {\n${B}\n},\n});`],
    [1, `({})[\n{\ntoString() {\n${B}\n},\n}\n];`],
    [1, `parseInt({\ntoString() {\n${B}\n},\n});`],
    [1, `new Error({\ntoString() {\n${B}\n},\n});`],
    [2, `\`\${{\n[Symbol.toPrimitive]() {\n${B}\n},\n}}\`;`],
    [1, `+{\n[Symbol.toPrimitive]() {\n${B}\n},\n};`],
    [2, `[2, 1].sort(() => {\n${B}\n});`],
    [1, `[2, 1].toSorted(() => {\n${B}\n});`],
    [2, `[1].map(() => {\n${B}\n});`],
    [1, `[1].forEach(() => {\n${B}\n});`],
    [1, `[1].filter(() => {\n${B}\n});`],
    [1, `[1, 2].reduce(() => {\n${B}\n});`],
    [1, `[1].find(() => {\n${B}\n});`],
    [1, `[1].some(() => {\n${B}\n});`],
    [1, `[1].flatMap(() => {\n${B}\n});`],
    [1, `[1].findLast(() => {\n${B}\n});`],
    [1, `Object.groupBy([1], () => {\n${B}\n});`],
    [2, `Array.from([1], () => {\n${B}\n});`],
    [1, `Array.from({\n*[Symbol.iterator]() {\n${B}\n},\n});`],
    [1, `Array.from({\nget length() {\n${B}\n},\n});`],
    [1, `new Uint8Array([2, 1]).sort(() => {\n${B}\n});`],
    [1, `new Uint8Array([1]).map(() => {\n${B}\n});`],
    [1, `new Map([[1, 1]]).forEach(() => {\n${B}\n});`],
    [1, `new Set([1]).forEach(() => {\n${B}\n});`],
    [1, `new Map({\n*[Symbol.iterator]() {\n${B}\n},\n});`],
    [1, `new Set({\n[Symbol.iterator]() {\nreturn {\nnext() {\n${B}\n},\n};\n},\n});`],
    [1, `Math.max(\n...{\n*[Symbol.iterator]() {\n${B}\n},\n},\n);`],
    [
      1,
      `for (const each of {\n[Symbol.iterator]() {\nreturn {\nnext() {\nreturn { done: false, value: 1 };\n},\nreturn() {\n${B}\n},\n};\n},\n})\nbreak;`,
    ],
    [2, `"x".replace("x", () => {\n${B}\n});`],
    [1, `"x".replace(/x/g, () => {\n${B}\n});`],
    [1, `"x".replaceAll("x", () => {\n${B}\n});`],
    [1, `"x".replace(\n{\n[Symbol.replace]() {\n${B}\n},\n},\n"",\n);`],
    [1, `"x".split({\n[Symbol.split]() {\n${B}\n},\n});`],
    [2, `Reflect.apply(\nfunction () {\n${B}\n},\nnull,\n[],\n);`],
    [1, `(function () {\n${B}\n}).call(null);`],
    [1, `(function () {\n${B}\n}).apply(null, []);`],
    [1, `(function () {\n${B}\n}).bind(null)();`],
    [1, `Reflect.construct(function () {\n${B}\n}, []);`],
    [2, `new Proxy(\n{},\n{\nget() {\n${B}\n},\n},\n).k;`],
    [1, `"k" in\nnew Proxy(\n{},\n{\nhas() {\n${B}\n},\n},\n);`],
    [1, `Object.keys(\nnew Proxy(\n{},\n{\nownKeys() {\n${B}\n},\n},\n),\n);`],
    [1, `new Proxy(\n{},\n{\nset() {\n${B}\n},\n},\n).k = 1;`],
    [1, `new Proxy(function () {}, {\napply() {\n${B}\n},\n})();`],
    [1, `JSON.stringify(\nnew Proxy(\n{ k: 1 },\n{\nget() {\n${B}\n},\n},\n),\n);`],
    [1, `(function (texts) {\n${B}\n})\`x\`;`],
    [1, `1 instanceof\n{\n[Symbol.hasInstance]() {\n${B}\n},\n};`],
    [1, `{\nusing held = {\n[Symbol.dispose]() {\n${B}\n},\n};\n}`],
    [1, `[].concat({\nget [Symbol.isConcatSpreadable]() {\n${B}\n},\n});`],
    [1, `Object.prototype.toString.call({\nget [Symbol.toStringTag]() {\n${B}\n},\n});`],
    [1, `Bun.inspect({\nget value() {\n${B}\n},\n});`],
    [1, `Bun.deepEquals(\n{\nget value() {\n${B}\n},\n},\n{ value: 1 },\n);`],
    [1, `(() => {\n${B}\n})();`],
  ];
  const waiting: [number, string][] = [
    [2, `await {\nthen(resolve) {\nqueueMicrotask(resolve);\n${B}\n},\n};`],
    [2, `await Promise.resolve().then(() => {\n${B}\n});`],
    [1, `await new Promise(resolve => {\nresolve(0);\n${B}\n});`],
    [1, `await Promise.all([\n{\nthen(resolve) {\nqueueMicrotask(resolve);\n${B}\n},\n},\n]);`],
    [1, `await (async () => {\n${B}\n})();`],
    [1, `await Array.fromAsync([1], () => {\n${B}\n});`],
    [1, `for await (const each of {\nasync *[Symbol.asyncIterator]() {\n${B}\n},\n});`],
    [
      1,
      `await new Promise((resolve, reject) => {\nqueueMicrotask(() => {\ntry {\n${B.replaceAll(/^return /gm, "")}\nresolve(0);\n} catch (error) {\nreject(error);\n}\n});\n});`,
    ],
    [
      1,
      `await new Promise((resolve, reject) => {\nsetTimeout(() => {\ntry {\n${B.replaceAll(/^return /gm, "")}\nresolve(0);\n} catch (error) {\nreject(error);\n}\n}, 0);\n});`,
    ],
  ];
  const waits = random.chance(0.15);
  const call = random.weighted(waits ? waiting : callers);

  const tells = random.pick([
    'console.log("caught", error?.constructor?.name ?? String(error));',
    'console.log("caught", error?.constructor?.name ?? String(error));',
    'console.log("caught", error?.constructor?.name ?? String(error), error?.name, error?.code);',
    'console.log("caught", error instanceof DOMException, error instanceof Error, typeof error?.stack);',
    'console.log("caught", Object.prototype.toString.call(error), typeof error?.message);',
  ]);
  const handled = `try {\n${call}\nconsole.log("nothing was thrown");\n} catch (error) {\n${tells}\n}`;
  const isModule = random.chance(0.5);
  const file = isModule ? "main.mjs" : "main.cjs";
  const a = waits ? "async " : "";
  const w = waits ? "await " : "";
  let place = random.pick(["top", "top", "once", "once", "thrice", "caller"] as const);
  if (waits && !isModule && place === "top") place = "once";
  const runs = (times: number) =>
    waits && !isModule ? `run()${".then(run)".repeat(times - 1)};` : Array(times).fill(`${w}run();`).join("\n");
  if (place === "top") return { file, text: `${handled}\n` };
  if (place === "caller")
    return {
      file,
      text: `${a}function inner() {\n${call}\n}\n${a}function run() {\ntry {\n${w}inner();\nconsole.log("nothing was thrown");\n} catch (error) {\n${tells}\n}\n}\n${runs(1)}\n`,
    };
  return { file, text: `${a}function run() {\n${handled}\n}\n${runs(place === "once" ? 1 : 3)}\n` };
}
