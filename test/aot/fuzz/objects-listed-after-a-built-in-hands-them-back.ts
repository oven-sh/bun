// An object whose members the compiler keeps track of (`process`, `console`, a module of Node.js, a namespace or a class of the program) goes into a
// built-in and comes back out of what the built-in made: a settled promise, a record, an error, an iterator result, an event, a callback's argument.
// The program then lists what came back without naming a single member. A program holds one object, one road and one way to list.
// The lines are sorted: in which order the names come is asked elsewhere.
import { sameObject } from "./members-of-bun-named-behind-built-ins-that-handed-it-on";

type Road = (from: string) => string;

// The compiler does not follow the object along these: the built-in keeps it where only native code reads it, and hands it back later.
const unseenRoads = new Set<Road>(sameObject.filter(road => road("$").includes("Promise.allSettled")));
const unseen = (road: Road) => (unseenRoads.add(road), road);
export const isUnseen = (road: Road) => unseenRoads.has(road);

const found = (statements: string) => `(() => {\nlet found;\n${statements}\nreturn found;\n})()`;
const foundLater = (statements: string) => `await (async () => {\nlet found;\n${statements}\nreturn found;\n})()`;
const stream = (from: string) =>
  `new ReadableStream({ start(controller) {\ncontroller.enqueue(${from});\ncontroller.close();\n} })`;

const throughPromises: readonly Road[] = [
  unseen(from => `(await Promise.allSettled(new Set([${from}])))[0].value`),
  unseen(from => `(await Promise.allSettled([Promise.resolve(${from})]))[0].value`),
  from => `(await Promise.allSettled([{ then(resolve) {\nresolve(${from});\n} }]))[0].value`,
  from => `(await Promise.allSettled([{ then(_, reject) {\nreject(${from});\n} }]))[0].reason`,
  from => `(await Promise.allSettled([(async () => {\nthrow ${from};\n})()]))[0].reason`,
  unseen(from => `Object.values((await Promise.allSettled([${from}]))[0])[1]`),
  unseen(from => `await Promise.any([Promise.reject(${from})]).catch(error => error.errors[0])`),
  from => `await Promise.any([(async () => {\nthrow ${from};\n})()]).catch(error => error.errors[0])`,
  from => `await Promise.any([{ then(_, reject) {\nreject(${from});\n} }]).catch(error => error.errors[0])`,
  unseen(
    from => `await Promise.any([new Promise((_, reject) => reject(${from}))]).catch(error => error.errors.at(-1))`,
  ),
  from => `(await Promise.all([Promise.resolve(${from})]))[0]`,
  unseen(from => `await Promise.all([Promise.reject(${from})]).catch(reason => reason)`),
  unseen(from => `await Promise.race([Promise.reject(${from})]).catch(reason => reason)`),
  from => `await Promise.reject(${from}).then(undefined, reason => reason)`,
  from => `await Promise.reject(${from}).finally(() => {}).catch(reason => reason)`,
  from => `await Promise.resolve().then(() => {\nthrow ${from};\n}).catch(reason => reason)`,
  from => `await (async () => {\nthrow ${from};\n})().catch(reason => reason)`,
  unseen(
    from => `await (async () => {\ntry {\nawait Promise.reject(${from});\n} catch (caught) {\nreturn caught;\n}\n})()`,
  ),
  unseen(from => `await new Promise((_, reject) => reject(${from})).catch(reason => reason)`),
  unseen(from => `await new Promise(() => {\nthrow ${from};\n}).catch(reason => reason)`),
  from =>
    `await (() => {\nconst { promise, reject } = Promise.withResolvers();\nreject(${from});\nreturn promise.catch(reason => reason);\n})()`,
  from => `await Promise.try(() => {\nthrow ${from};\n}).catch(reason => reason)`,
  from => `await Promise.try(value => value, ${from})`,
  from => `await new (class extends Promise {})(resolve => resolve(${from}))`,
  from => `(await Array.fromAsync([${from}]))[0]`,
  from => `(await Array.fromAsync([Promise.resolve(${from})]))[0]`,
  from => `(await Array.fromAsync({ length: 1, 0: ${from} }))[0]`,
  from => `(await Array.fromAsync([1], () => ${from}))[0]`,
  from => `(await Array.fromAsync((async function* () {\nyield ${from};\n})()))[0]`,
  from => `Bun.peek(Promise.resolve(${from}))`,
];

const throughErrors: readonly Road[] = [
  from => `new AggregateError([${from}]).errors[0]`,
  from => `new AggregateError(new Set([${from}])).errors[0]`,
  from => `new Error("", { cause: ${from} }).cause`,
  from => `new AggregateError([], "", { cause: ${from} }).cause`,
  unseen(from => `new SuppressedError(${from}, 1).error`),
  unseen(from => `new SuppressedError(1, ${from}).suppressed`),
  unseen(from => `AbortSignal.abort(${from}).reason`),
  unseen(from => `AbortSignal.any([AbortSignal.abort(${from})]).reason`),
  from =>
    `(() => {\nconst controller = new AbortController();\ncontroller.abort(${from});\nreturn controller.signal.reason;\n})()`,
  unseen(
    from =>
      `(() => {\ntry {\nAbortSignal.abort(${from}).throwIfAborted();\n} catch (caught) {\nreturn caught;\n}\n})()`,
  ),
  from => `(() => {\ntry {\n[1].forEach(() => {\nthrow ${from};\n});\n} catch (caught) {\nreturn caught;\n}\n})()`,
  unseen(
    from =>
      `(() => {\ntry {\nJSON.stringify({ toJSON() {\nthrow ${from};\n} });\n} catch (caught) {\nreturn caught;\n}\n})()`,
  ),
  unseen(
    from =>
      `(() => {\ntry {\nnobody({ valueOf() {\nthrow ${from};\n} } + 1);\n} catch (caught) {\nreturn caught;\n}\n})()`,
  ),
  unseen(
    from =>
      `(() => {\ntry {\nconst stack = new DisposableStack();\nstack.defer(() => {\nthrow ${from};\n});\nstack.dispose();\n} catch (caught) {\nreturn caught;\n}\n})()`,
  ),
  unseen(
    from =>
      `(() => {\ntry {\nconst stack = new DisposableStack();\nstack.defer(() => {\nthrow 1;\n});\nstack.defer(() => {\nthrow ${from};\n});\nstack.dispose();\n} catch (caught) {\nreturn caught.suppressed;\n}\n})()`,
  ),
];

const throughCollections: readonly Road[] = [
  from => `Map.groupBy([${from}], () => "k").get("k")[0]`,
  from => `Map.groupBy([1], () => ${from}).keys().next().value`,
  from => `new Map([["k", ${from}]]).entries().next().value[1]`,
  from => `[...new Map([["k", ${from}]])][0][1]`,
  from => `new Map().set("k", ${from}).get("k")`,
  from => `new Map(new Map([["k", ${from}]])).get("k")`,
  from => `new Map(Object.entries({ k: ${from} })).get("k")`,
  from => found(`new Map([["k", ${from}]]).forEach(value => {\nfound = value;\n});`),
  from => found(`new Map([[${from}, 1]]).forEach((_, name) => {\nfound = name;\n});`),
  from => found(`new Set([${from}]).forEach(value => {\nfound = value;\n});`),
  from => found(`new Set([1]).forEach(function () {\nfound = this;\n}, ${from});`),
  from => `new Set().add(${from}).values().next().value`,
  from => `new Set([${from}]).entries().next().value[0]`,
  from => `new Set([${from}]).keys().next().value`,
  from => `new Set([${from}]).union(new Set()).values().next().value`,
  from => `new Set().union(new Set([${from}])).values().next().value`,
  from => `new Set([${from}]).intersection(new Set([${from}])).values().next().value`,
  from => `new Set([${from}]).difference(new Set()).values().next().value`,
  from => `new Set([${from}]).symmetricDifference(new Set()).values().next().value`,
  from => `new WeakMap().set(lines, ${from}).get(lines)`,
];

const throughIterators: readonly Road[] = [
  from => `Iterator.from([${from}]).next().value`,
  from => `Iterator.from({ next: () => ({ done: false, value: ${from} }) }).next().value`,
  from => `Iterator.from([${from}]).map(value => value).next().value`,
  from => `Iterator.from([1]).map(() => ${from}).next().value`,
  from => `Iterator.from([${from}]).filter(Boolean).next().value`,
  from => `Iterator.from([${from}]).take(1).next().value`,
  from => `Iterator.from([${from}]).drop(0).next().value`,
  from => `Iterator.from([1]).flatMap(() => [${from}]).next().value`,
  from => `Iterator.from([${from}]).toArray()[0]`,
  from => `Iterator.from([${from}]).find(Boolean)`,
  from => `Iterator.from([${from}]).reduce((_, value) => value, 0)`,
  from => found(`Iterator.from([${from}]).forEach(value => {\nfound = value;\n});`),
  from => `[${from}].values().toArray()[0]`,
  from => `(function* () {\nyield* [${from}];\n})().next().value`,
  from => `(function* () {})().return(${from}).value`,
  from => `(await (async function* () {})().return(${from})).value`,
  from =>
    `(() => {\nconst steps = (function* () {\nreturn yield;\n})();\nsteps.next();\nreturn steps.next(${from}).value;\n})()`,
  from =>
    `(() => {\nconst steps = (function* () {\ntry {\nyield;\n} catch (caught) {\nreturn caught;\n}\n})();\nsteps.next();\nreturn steps.throw(${from}).value;\n})()`,
  from => `(([first]) => first)(new Set([${from}]))`,
  from => `(value => value)(...new Set([${from}]))`,
];

const throughLists: readonly Road[] = [
  from => `[${from}].toSpliced(0, 0)[0]`,
  from => `[1].toSpliced(0, 1, ${from})[0]`,
  from => `[${from}].copyWithin(0, 0)[0]`,
  from => `[${from}].sort()[0]`,
  from => `[${from}].reduceRight((_, value) => value, 0)`,
  from => `[[[${from}]]].flat(Infinity)[0]`,
  from => found(`[${from}, ${from}].sort(first => {\nfound = first;\nreturn 0;\n});`),
  from => found(`[${from}].forEach(value => {\nfound = value;\n});`),
  from => found(`[${from}].some(value => {\nfound = value;\n});`),
  from => found(`[${from}].every(value => {\nfound = value;\n});`),
  from => found(`[${from}].findIndex(value => {\nfound = value;\n});`),
  from => found(`[1].forEach(function () {\nfound = this;\n}, ${from});`),
  from => found(`[${from}].map((_, index, all) => {\nfound = all[index];\n});`),
  from => `Array.from(new Set([${from}]))[0]`,
  from => `Array.from([1], function () {\nreturn this;\n}, ${from})[0]`,
  from => `Array.prototype.concat.call([], [${from}])[0]`,
  from => `Array.prototype.slice.call({ length: 1, 0: ${from} })[0]`,
  from => `new Array(${from}, 1)[0]`,
  from => `Array(${from}, 1)[0]`,
  from => `Reflect.construct(Array, [${from}, 1])[0]`,
  from => `Reflect.apply(Array.of, Array, [${from}])[0]`,
  from => `new (class extends Array {})(${from}, 1)[0]`,
  from => `(() => {\nconst list = [];\nlist.push(${from});\nreturn list[0];\n})()`,
  from => `(() => {\nconst list = [];\nlist.unshift(${from});\nreturn list[0];\n})()`,
  from => `(() => {\nconst list = [];\nlist[nobody(0) ? 1 : 0] = ${from};\nreturn list[nobody(0) ? 1 : 0];\n})()`,
];

const throughObjects: readonly Road[] = [
  from => `Object.entries([${from}])[0][1]`,
  from => `Object.values([${from}])[0]`,
  from => `Object.fromEntries(new Map([["k", ${from}]])).k`,
  from => `Object.assign(Object.create(null), { k: ${from} }).k`,
  from => `Object.freeze({ k: ${from} }).k`,
  from => `Object.seal({ k: ${from} }).k`,
  from => `Object.defineProperties({}, { k: { value: ${from} } }).k`,
  from => `Object.defineProperty({}, "k", { get: () => ${from} }).k`,
  from => `Object.getOwnPropertyDescriptor({ get k() {\nreturn ${from};\n} }, "k").get()`,
  from => `Reflect.getOwnPropertyDescriptor({ k: ${from} }, "k").value`,
  from => `Reflect.construct(function () {\nthis.k = ${from};\n}, []).k`,
  from => `Reflect.get({ get k() {\nreturn this;\n} }, "k", ${from})`,
  from => found(`Reflect.set({ set k(value) {\nfound = value;\n} }, "k", ${from});`),
  from => found(`Reflect.set({ set k(_) {\nfound = this;\n} }, "k", 1, ${from});`),
  from => `new Object(${from})`,
  from => `JSON.parse("1", () => ${from})`,
  from => `JSON.parse('{"k":1}', (name, value) => (name === "k" ? ${from} : value)).k`,
  from => `JSON.parse("[1]", (name, value) => (name === "0" ? ${from} : value))[0]`,
  from =>
    found(`JSON.stringify({ k: ${from} }, (name, value) => {\nif (name !== "k") return value;\nfound = value;\n});`),
  from => found(`JSON.stringify([1], function () {\nfound = this.held;\nreturn 1;\n}.bind({ held: ${from} }));`),
  from => found(`"a".replace("a", () => {\nfound = ${from};\nreturn "";\n});`),
  from => `new (class {\n#held = ${from};\nget held() {\nreturn this.#held;\n}\n})().held`,
  from => `(class {\nstatic held = ${from};\n}).held`,
  from => `((value = ${from}) => value)()`,
  from => `(({ k }) => k)({ k: ${from} })`,
  from => `(({ ...rest }) => rest.k)({ k: ${from} })`,
  from => `((_, value) => value)\`\${${from}}\``,
  from => `(0, ${from})`,
  from => `(nobody(1) ? ${from} : 0)`,
  from => `(nobody(0) ?? ${from})`,
  from => `nobody({ k: ${from} }) && ${from}`,
];

const throughTheHost: readonly Road[] = [
  from => `new CustomEvent("x", { detail: ${from} }).detail`,
  from => `new MessageEvent("x", { data: ${from} }).data`,
  from => `new ErrorEvent("x", { error: ${from} }).error`,
  from =>
    found(
      `const target = new EventTarget();\ntarget.addEventListener("x", event => {\nfound = event.detail;\n});\ntarget.dispatchEvent(new CustomEvent("x", { detail: ${from} }));`,
    ),
  from => `await new Promise(resolve => setTimeout(resolve, 0, ${from}))`,
  from => `await new Promise(resolve => setImmediate(resolve, ${from}))`,
  from => `await new Promise(resolve => queueMicrotask(() => resolve(${from})))`,
  from => `await new Promise(resolve => queueMicrotask(resolve.bind(undefined, ${from})))`,
  unseen(from => `(await ${stream(from)}.getReader().read()).value`),
  unseen(from => `(await Array.fromAsync(${stream(from)}))[0]`),
  unseen(from => `(await Bun.readableStreamToArray(${stream(from)}))[0]`),
  unseen(from => `(await ${stream(from)}.pipeThrough(new TransformStream()).getReader().read()).value`),
  unseen(from => `(await ${stream(from)}.tee()[1].getReader().read()).value`),
  unseen(from =>
    foundLater(`await ${stream(from)}.pipeTo(new WritableStream({ write(chunk) {\nfound = chunk;\n} }));`),
  ),
  from => `(() => {\nconst stack = new DisposableStack();\nreturn stack.adopt(${from}, () => {});\n})()`,
  from =>
    found(
      `const stack = new DisposableStack();\nstack.adopt(${from}, value => {\nfound = value;\n});\nstack.dispose();`,
    ),
  from =>
    foundLater(
      `const stack = new AsyncDisposableStack();\nstack.adopt(${from}, value => {\nfound = value;\n});\nawait stack.disposeAsync();`,
    ),
  from =>
    `new (require("node:async_hooks").AsyncLocalStorage)().run(${from}, function () {\nreturn this;\n}.bind(${from}))`,
  from =>
    `(() => {\nconst storage = new (require("node:async_hooks").AsyncLocalStorage)();\nreturn storage.run(${from}, () => storage.getStore());\n})()`,
  from =>
    found(
      `const emitter = new (require("node:events"))();\nemitter.on("x", value => {\nfound = value;\n});\nemitter.emit("x", ${from});`,
    ),
  from =>
    `(await (() => {\nconst events = require("node:events");\nconst emitter = new events();\nconst heard = events.once(emitter, "x");\nemitter.emit("x", ${from});\nreturn heard;\n})())[0]`,
  from => `await require("node:util").promisify(done => done(null, ${from}))()`,
  from => `await require("node:util").promisify(done => done(${from}))().catch(reason => reason)`,
  from => `(await require("node:stream").Readable.from([${from}]).toArray())[0]`,
  from => `await require("node:timers/promises").setTimeout(0, ${from})`,
  from => `await require("node:timers/promises").setImmediate(${from})`,
];

// The object is an argument of a method that the compiler does not know.
const throughMethodsNobodyKnows: readonly Road[] = [
  unseen(
    from => `await (() => {\nconst made = Promise.withResolvers();\nmade.resolve(${from});\nreturn made.promise;\n})()`,
  ),
  unseen(
    from =>
      `await (() => {\nconst made = Promise.withResolvers();\nmade.reject(${from});\nreturn made.promise.catch(reason => reason);\n})()`,
  ),
  unseen(from => `new Proxy({}, { get: () => value => value }).anything(${from})`),
];

export const roads: readonly Road[] = [
  from => from,
  ...sameObject,
  ...throughPromises,
  ...throughErrors,
  ...throughCollections,
  ...throughIterators,
  ...throughLists,
  ...throughObjects,
  ...throughTheHost,
  ...throughMethodsNobodyKnows,
];

export type Subject = {
  /** An expression for the object. */
  path: string;
  needs?: string;
  files?: Record<string, string>;
  /** Its functions are the program's own: each is called. */
  isOfProgram?: true;
  /** An executable holds the members of this one that the program names, so only the names are listed. */
  onlyNames?: true;
  /** Its members are not enumerable. */
  ownNames?: true;
};

const ownModule = `export function first() {\nreturn "first ran";\n}\nexport const second = () => "second ran";\nexport class Third {\nstatic made() {\nreturn "third ran";\n}\n}\nexport let fourth = { inner: () => "fourth ran" };\nexport default function () {\nreturn "default ran";\n}\n`;
const ownCommonJS = `exports.first = function () {\nreturn "first ran";\n};\nexports.second = () => "second ran";\nexports.third = { inner: () => "third ran" };\n`;

export const subjects: readonly Subject[] = [
  { path: "process" },
  { path: "globalThis.process" },
  { path: "ofNode", needs: `import ofNode from "node:process";` },
  { path: "console" },
  { path: "process.versions" },
  { path: "process.release" },
  { path: "process.features" },
  { path: "process.config" },
  { path: "process.report" },
  { path: "process.memoryUsage" },
  { path: "process.hrtime" },
  { path: "performance" },
  { path: "navigator" },
  { path: "Bun", onlyNames: true },
  { path: "globalThis", onlyNames: true },
  { path: "Bun.hash" },
  { path: "Bun.semver" },
  { path: "Bun.password" },
  { path: "Bun.unsafe" },
  { path: "Bun.dns" },
  { path: "Bun.inspect" },
  { path: "path", needs: `import path from "node:path";` },
  { path: "allOfPath", needs: `import * as allOfPath from "node:path";` },
  { path: "os", needs: `import os from "node:os";` },
  { path: "util", needs: `import util from "node:util";` },
  { path: "util.types", needs: `import util from "node:util";` },
  { path: "events", needs: `import events from "node:events";` },
  { path: "url", needs: `import * as url from "node:url";` },
  { path: "fs", needs: `import fs from "node:fs";` },
  { path: "fs.promises", needs: `import fs from "node:fs";` },
  { path: "fs.constants", needs: `import fs from "node:fs";` },
  { path: "tls", needs: `import tls from "node:tls";` },
  { path: "timers", needs: `const timers = require("node:timers");` },
  { path: "buffer", needs: `const buffer = await import("node:buffer");` },
  { path: "querystring", needs: `const querystring = process.getBuiltinModule("node:querystring");` },
  { path: "Math", ownNames: true },
  { path: "JSON", ownNames: true },
  { path: "Reflect", ownNames: true },
  { path: "Atomics", ownNames: true },
  { path: "Intl", ownNames: true },
  { path: "own", needs: `import * as own from "./own.mjs";`, files: { "own.mjs": ownModule }, isOfProgram: true },
  { path: "own", needs: `const own = await import("./own.mjs");`, files: { "own.mjs": ownModule }, isOfProgram: true },
  { path: "own", needs: `import own from "./own.cjs";`, files: { "own.cjs": ownCommonJS }, isOfProgram: true },
  { path: "own", needs: `const own = require("./own.cjs");`, files: { "own.cjs": ownCommonJS }, isOfProgram: true },
  {
    path: "Own",
    needs: `class Own {\nstatic first = () => "first ran";\nstatic second = { inner: () => "second ran" };\nstatic third() {\nreturn "third ran";\n}\n}`,
    isOfProgram: true,
  },
  {
    path: "own",
    needs: `const own = { first() {\nreturn "first ran";\n}, second: () => "second ran", get third() {\nreturn () => "third ran";\n}, fourth: { inner: () => "fourth ran" } };`,
    isOfProgram: true,
  },
  {
    path: "own",
    needs: `function own() {}\nown.first = () => "first ran";\nown.second = function () {\nreturn "second ran";\n};`,
    isOfProgram: true,
  },
  {
    path: "own",
    needs: `const own = new (class {\nfirst = () => "first ran";\nsecond = { inner: () => "second ran" };\n})();`,
    isOfProgram: true,
  },
];

/** Each takes the name of what came back and gives an expression for a list of [name, member]. */
export const listings: readonly (readonly [string, (handed: string) => string])[] = [
  ["Object.entries", handed => `Object.entries(${handed})`],
  ["Object.keys", handed => `Object.keys(${handed}).map(name => [name, ${handed}[name]])`],
  ["Object.values", handed => `Object.values(${handed}).map(member => ["", member])`],
  [
    "for in",
    handed =>
      `(() => {\nconst all = [];\nfor (const name in ${handed}) all.push([name, ${handed}[name]]);\nreturn all;\n})()`,
  ],
  ["spread", handed => `Object.entries({ ...${handed} })`],
  ["rest", handed => `(({ ...rest }) => Object.entries(rest))(${handed})`],
  ["Object.assign", handed => `Object.entries(Object.assign({}, ${handed}))`],
  [
    "descriptors",
    handed =>
      `Object.entries(Object.getOwnPropertyDescriptors(${handed})).filter(([, found]) => found.enumerable).map(([name, found]) => [name, "value" in found ? found.value : found.get?.call(${handed})])`,
  ],
  [
    "Reflect.ownKeys",
    handed =>
      `Reflect.ownKeys(${handed}).filter(name => Object.prototype.propertyIsEnumerable.call(${handed}, name)).map(name => [String(name), Reflect.get(${handed}, name)])`,
  ],
  [
    "JSON.stringify",
    handed =>
      `(() => {\nconst all = [];\nJSON.stringify(${handed}, function (name, member) {\nif (this !== ${handed}) return name === "" ? member : undefined;\nall.push([name, member]);\n});\nreturn all;\n})()`,
  ],
];

const ownNames = (handed: string) => `Object.getOwnPropertyNames(${handed}).map(name => [name, ${handed}[name]])`;

export function nameOf(subject: Subject, road: Road, listing: string) {
  const how = subject.needs ? ` (${subject.needs.split("\n")[0]})` : "";
  return `${subject.path}${how} | ${road("$").replaceAll("\n", " ")} | ${listing}`;
}

export function generate(subject: Subject, road: Road, listing: (handed: string) => string): string {
  const text: string[] = [];
  if (subject.needs?.startsWith("import ")) text.push(subject.needs);
  text.push(`const lines = [];`);
  text.push(`const key = name => process.argv[9] ?? name;`);
  text.push(`const nobody = globalThis[process.argv[2] ?? "Boolean"];`);
  if (subject.needs && !subject.needs.startsWith("import ")) text.push(subject.needs);
  text.push(
    subject.onlyNames
      ? `const show = () => "";`
      : subject.isOfProgram
        ? `const show = member =>\ntypeof member === "function" && !/^class/.test(member) ? "function " + member() : typeof member === "object" && member !== null ? "object " + Object.values(member).map(show) : typeof member;`
        : `const show = member => (typeof member === "function" ? "function " + member.name + " " + member.length : typeof member);`,
  );
  text.push(`const handed = ${road(subject.path)};`);
  text.push(`lines.push(handed === ${subject.path});`);
  text.push(
    `for (const [name, member] of ${(subject.ownNames ? ownNames : listing)("handed")}) lines.push(name + " " + show(member));`,
  );
  text.push(`console.log(lines.sort().join("\\n"));`);
  return text.join("\n") + "\n";
}
