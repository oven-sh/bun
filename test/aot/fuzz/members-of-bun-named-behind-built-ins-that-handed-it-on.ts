// `Bun` is handed to a function picked at run time, something is stored on globalThis under a key picked at run time, and then `Bun` goes through
// a row of built-ins: promises, lists, maps, sets, generators, copies, descriptors, proxies and objects that inherit from it. Behind the row a
// member is named: read, called, constructed, stored, taken apart or asked for under a key. Each use writes down what it saw.
import type { Random } from "./random";

// Each step takes the name of what holds Bun and gives an expression for what holds it next.
export const sameObject: readonly ((from: string) => string)[] = [
  from => `await ${from}`,
  from => `await Promise.resolve(${from})`,
  from => `await Promise.resolve(1).then(() => ${from})`,
  from => `await Promise.resolve(${from}).then(value => value)`,
  from => `await Promise.resolve(${from}).finally(() => {})`,
  from => `await Promise.reject(${from}).catch(value => value)`,
  from => `await new Promise(resolve => resolve(${from}))`,
  from => `(await Promise.all([${from}]))[0]`,
  from => `(await Promise.all(new Set([${from}])))[0]`,
  from => `await Promise.any([${from}])`,
  from => `await Promise.any([Promise.reject(1), ${from}])`,
  from => `await Promise.race([${from}])`,
  from => `(await Promise.allSettled([${from}]))[0].value`,
  from => `(await Promise.allSettled([Promise.reject(${from})]))[0].reason`,
  from =>
    `await (() => {\nconst { promise, resolve } = Promise.withResolvers();\nresolve(${from});\nreturn promise;\n})()`,
  from => `await Promise.try(() => ${from})`,
  from => `await { then(resolve) {\nresolve(${from});\n} }`,
  from => `await (async () => ${from})()`,
  from => `(await (async function* () {\nyield ${from};\n})().next()).value`,
  from => `(function* () {\nyield ${from};\n})().next().value`,
  from => `[...(function* () {\nyield ${from};\n})()][0]`,
  from => `new Map([["k", ${from}]]).get("k")`,
  from => `[...new Map([["k", ${from}]]).values()][0]`,
  from => `[...new Map([[${from}, 1]]).keys()][0]`,
  from => `[...new Set([${from}])][0]`,
  from => `new Set([${from}]).values().next().value`,
  from => `new WeakRef(${from}).deref()`,
  from => `new WeakMap([[lines, ${from}]]).get(lines)`,
  from => `[${from}].at(0)`,
  from => `[${from}].map(value => value)[0]`,
  from => `[${from}].filter(Boolean)[0]`,
  from => `[${from}].find(Boolean)`,
  from => `[${from}].findLast(Boolean)`,
  from => `[[${from}]].flat()[0]`,
  from => `[1].flatMap(() => [${from}])[0]`,
  from => `[${from}].concat()[0]`,
  from => `[].concat(${from})[0]`,
  from => `[${from}].slice()[0]`,
  from => `[${from}].splice(0, 1)[0]`,
  from => `[${from}].reverse()[0]`,
  from => `[${from}].toReversed()[0]`,
  from => `[${from}].toSorted()[0]`,
  from => `[1].with(0, ${from})[0]`,
  from => `[1].fill(${from})[0]`,
  from => `[${from}].pop()`,
  from => `[${from}].shift()`,
  from => `[${from}].reduce((_, value) => value, 0)`,
  from => `[${from}].entries().next().value[1]`,
  from => `[${from}].values().next().value`,
  from => `Array.from([${from}])[0]`,
  from => `Array.from({ length: 1 }, () => ${from})[0]`,
  from => `Array.of(${from})[0]`,
  from => `Object.groupBy([${from}], () => "k").k[0]`,
  from => `Object.entries({ k: ${from} })[0][1]`,
  from => `Object.values({ k: ${from} })[0]`,
  from => `Object.fromEntries([["k", ${from}]]).k`,
  from => `Object.assign({}, { k: ${from} }).k`,
  from => `{ ...{ k: ${from} } }.k`,
  from => `Reflect.get({ k: ${from} }, "k")`,
  from => `Object.getOwnPropertyDescriptor({ k: ${from} }, "k").value`,
  from => `Object.getOwnPropertyDescriptors({ k: ${from} }).k.value`,
  from => `Object.defineProperty({}, "k", { value: ${from} }).k`,
  from => `Object.create(null, { k: { value: ${from} } }).k`,
  from => `Object.create({ k: ${from} }).k`,
  from => `(() => {\nconst holder = {};\nReflect.set(holder, "k", ${from});\nreturn holder.k;\n})()`,
  from => `(() => {\nconst holder = {};\nholder[key("k")] = ${from};\nreturn holder[key("k")];\n})()`,
  from => `(() => {\nglobalThis[key("held")] = ${from};\nreturn globalThis[key("held")];\n})()`,
  from => `(() => {\nglobalThis[key("held")] = ${from};\nreturn globalThis.held;\n})()`,
  from => `Object(${from})`,
  from => `Object.getPrototypeOf(Object.create(${from}))`,
  from => `Reflect.getPrototypeOf(Object.setPrototypeOf({}, ${from}))`,
  from => `Reflect.apply(value => value, undefined, [${from}])`,
  from => `(value => value).call(undefined, ${from})`,
  from => `(value => value).bind(undefined, ${from})()`,
  from => `(function () {\nreturn this;\n}).call(${from})`,
  from => `(function () {\nreturn arguments[0];\n})(${from})`,
  from => `((...rest) => rest[0])(${from})`,
  from => `(() => {\ntry {\nthrow ${from};\n} catch (caught) {\nreturn caught;\n}\n})()`,
  from => `new (class {\nheld = ${from};\n})().held`,
  from => `(nobody(0) || ${from})`,
  from => `(nobody(1) && ${from})`,
  from => `new Proxy({}, { get: () => ${from} }).anything`,
];

export const standsForIt: readonly ((from: string) => string)[] = [
  from => `new Proxy(${from}, {})`,
  from => `new Proxy(${from}, { get: (target, name, receiver) => Reflect.get(target, name, receiver) })`,
  from => `new Proxy(${from}, { get: (target, name) => target[name] })`,
  from => `Object.create(${from})`,
  from => `Object.setPrototypeOf({}, ${from})`,
  from => `{ __proto__: ${from} }`,
  from => `{ ...${from} }`,
  from => `Object.assign({}, ${from})`,
  from => `Object.fromEntries(Object.entries(${from}))`,
  from => `Object.defineProperties({}, Object.getOwnPropertyDescriptors(${from}))`,
  from => `Object.fromEntries(Reflect.ownKeys(${from}).map(name => [name, ${from}[name]]))`,
];

// A member and an expression over `member` whose answer does not hang on the machine or the time.
const members: readonly (readonly [string, string])[] = [
  ["escapeHTML", `member("<a>")`],
  ["stringWidth", `member("abc")`],
  ["deepEquals", `member({ a: [1] }, { a: [1] })`],
  ["deepMatch", `member({ a: 1 }, { a: 1, b: 2 })`],
  ["inspect", `member({ a: [1, "s"] })`],
  ["hash", `String(member("x"))`],
  ["hash", `member.crc32("x")`],
  ["hash", `String(member.wyhash("x"))`],
  ["nanoseconds", `typeof member()`],
  ["sleepSync", `member(0)`],
  ["sleep", `await member(0)`],
  ["peek", `member(Promise.resolve(3))`],
  ["indexOfLine", `member(new Uint8Array([1, 10]), 0)`],
  ["concatArrayBuffers", `member([new Uint8Array([1]), new Uint8Array([2, 3])]).byteLength`],
  ["fileURLToPath", `member("file:///a/b")`],
  ["pathToFileURL", `member("/a/b").href`],
  ["stripANSI", `member("\\x1b[1mx\\x1b[0m")`],
  ["semver", `member.satisfies("1.2.3", "^1")`],
  ["semver", `member.order("1.0.0", "2.0.0")`],
  ["TOML", `member.parse("a = 1").a`],
  ["YAML", `member.parse("a: 1").a`],
  ["color", `member("red", "hex")`],
  ["randomUUIDv7", `member().length`],
  ["gzipSync", `member(new Uint8Array([1, 2, 3])).length > 0`],
  ["gunzipSync", `typeof member`],
  ["deflateSync", `member(new Uint8Array([1, 2, 3])).length > 0`],
  ["inflateSync", `typeof member`],
  ["zstdCompressSync", `member(new Uint8Array([1, 2, 3])).length > 0`],
  ["zstdDecompressSync", `typeof member`],
  ["CryptoHasher", `new member("sha1").update("x").digest("hex")`],
  ["SHA1", `member.hash("x", "hex")`],
  ["SHA256", `member.hash("x", "hex")`],
  ["MD5", `member.hash("x", "hex")`],
  ["Glob", `new member("*.ts").match("a.ts")`],
  ["Transpiler", `new member({ loader: "ts" }).transformSync("let a: number = 1; a;").trim()`],
  ["SQL", `typeof new member("postgres://127.0.0.1:1/x")`],
  [
    "ArrayBufferSink",
    `(() => {\nconst sink = new member();\nsink.start();\nsink.write("xy");\nreturn sink.end().byteLength;\n})()`,
  ],
  ["file", `member("/nowhere/at-all").name`],
  ["file", `await member("/nowhere/at-all").exists()`],
  ["env", `typeof member.PATH`],
  ["isMainThread", `member`],
  ["which", `typeof member("sh")`],
  ["readableStreamToText", `await member(new Response("body").body)`],
  ["readableStreamToJSON", `(await member(new Response("[1]").body))[0]`],
  ["readableStreamToArrayBuffer", `(await member(new Response("body").body)).byteLength`],
  ["readableStreamToBytes", `(await member(new Response("body").body)).length`],
  ["readableStreamToArray", `(await member(new Response("body").body)).length`],
  ["readableStreamToBlob", `(await member(new Response("body").body)).size`],
  ["CookieMap", `new member("a=1").get("a")`],
  ["Cookie", `new member("a", "1").value`],
  ["gc", `typeof member(true)`],
  ["shrink", `member()`],
  [
    "serve",
    `(() => {\nconst server = member({ port: 0, fetch: () => new Response("x") });\nconst kind = typeof server.port;\nserver.stop(true);\nreturn kind;\n})()`,
  ],
  ["spawnSync", `member(["true"]).exitCode`],
  ["spawn", `await member(["true"]).exited`],
  ["$", `(await member\`echo hi\`.text()).trim()`],
  ["password", `typeof member.hashSync`],
  ["dns", `typeof member.lookup`],
  ["listen", `typeof member`],
  ["connect", `typeof member`],
  ["udpSocket", `typeof member`],
  ["stdin", `typeof member.stream`],
  ["stdout", `typeof member.writer`],
  ["stderr", `typeof member.writer`],
  ["plugin", `typeof member`],
  ["build", `typeof member`],
  ["FileSystemRouter", `typeof member`],
  ["S3Client", `new member({}).file("a").name`],
  ["s3", `typeof member.file`],
  ["RedisClient", `typeof member`],
  ["redis", `typeof member`],
  ["sql", `typeof member`],
  ["postgres", `typeof member`],
  ["write", `typeof member`],
  ["mmap", `typeof member`],
  ["resolveSync", `typeof member`],
  ["resolve", `typeof member`],
  ["allocUnsafe", `member(3).length`],
  ["unsafe", `typeof member.arrayBufferToString`],
  ["jest", `typeof member`],
  ["embeddedFiles", `Array.isArray(member)`],
  ["cron", `typeof member`],
  ["secrets", `typeof member`],
  ["CSRF", `typeof member.generate`],
  ["JSONC", `typeof member`],
  ["JSON5", `typeof member`],
  ["markdown", `typeof member`],
  ["Archive", `typeof member`],
  ["Terminal", `typeof member`],
  ["wrapAnsi", `typeof member`],
  ["enableANSIColors", `typeof member`],
  ["version", `typeof member`],
  ["revision", `typeof member`],
  ["notAMember", `typeof member`],
];

const takes: readonly ((holder: string, name: string) => string)[] = [
  (holder, name) => `const member = ${holder}.${name};`,
  (holder, name) => `const member = ${holder}["${name}"];`,
  (holder, name) => `const member = ${holder}[key("${name}")];`,
  (holder, name) => `const { ${name}: member } = ${holder};`,
  (holder, name) => `const { [key("${name}")]: member } = ${holder};`,
  (holder, name) => `const member = Reflect.get(${holder}, "${name}");`,
  (holder, name) => `const member = Reflect.get(${holder}, key("${name}"));`,
  (holder, name) => `const member = ${holder}?.${name};`,
  (holder, name) => `const kept = [];\nkept.push(${holder}.${name});\nconst member = kept[0];`,
  (holder, name) => `const kept = { inside: ${holder}.${name} };\nconst member = kept[key("inside")];`,
  (holder, name) => `const member = await Promise.resolve(${holder}).then(value => value.${name});`,
  (holder, name) => `const member = [${holder}].map(value => value.${name})[0];`,
  (holder, name) => `const member = (value => value.${name})(${holder});`,
  (holder, name) => `let member;\nfor (const name of ["${name}"]) member = ${holder}[name];`,
  (holder, name) => `let member;\nfor (const name in ${holder}) if (name === "${name}") member = ${holder}[name];`,
  (holder, name) => `const member = Object.entries(${holder}).find(([name]) => name === "${name}")?.[1];`,
];

const asks: readonly ((holder: string, name: string) => string)[] = [
  (holder, name) => `"${name}" in ${holder}`,
  (holder, name) => `key("${name}") in ${holder}`,
  (holder, name) => `Object.hasOwn(${holder}, "${name}")`,
  (holder, name) => `Reflect.has(${holder}, "${name}")`,
  (holder, name) => `Object.keys(${holder}).includes("${name}")`,
  (holder, name) => `Reflect.ownKeys(${holder}).includes("${name}")`,
  (holder, name) => `Object.getOwnPropertyNames(${holder}).includes("${name}")`,
  (holder, name) => `shape(Object.getOwnPropertyDescriptor(${holder}, "${name}"))`,
  (holder, name) => `shape(Object.getOwnPropertyDescriptors(${holder}).${name})`,
  (holder, name) => `shape(Reflect.getOwnPropertyDescriptor(${holder}, key("${name}")))`,
  (holder, name) => `typeof ${holder}.${name}`,
  (holder, name) => `${holder}.${name} === Bun.${name}`,
  (holder, name) => `${holder}.${name} === globalThis.Bun[key("${name}")]`,
  (holder, name) => `${holder}.propertyIsEnumerable?.("${name}")`,
];

export function generate(random: Random): string {
  const text: string[] = [];
  text.push(`const lines = [];`);
  text.push(`const key = name => process.argv[9] ?? name;`);
  text.push(`const nobody = globalThis[process.argv[2] ?? "Boolean"];`);
  text.push(
    `const shape = found =>\nfound === undefined\n? "none"\n: [typeof found.value, typeof found.get, typeof found.set, found.writable, found.enumerable, found.configurable].join(" ");`,
  );
  text.push(
    `const show = value =>\ntypeof value === "function" ? "function" : typeof value === "object" && value !== null ? "object" : typeof value === "bigint" ? value + "n" : String(value);`,
  );
  if (random.chance(0.7)) text.push(`globalThis[process.argv[3] ?? "nothing"] = nobody(1);`);
  if (random.chance(0.7)) text.push(`nobody(Bun);`);
  if (random.chance(0.2)) text.push(`globalThis[process.argv[3] ?? "kept"] = Bun;`);
  const rows = random.between(1, 3);
  for (let row = 0; row < rows; row++) {
    let holder = random.pick(["Bun", "Bun", "globalThis.Bun", `globalThis[key("Bun")]`]);
    const steps = random.between(0, 14);
    const body: string[] = [];
    let copies = 0;
    for (let step = 0; step < steps; step++) {
      const stands = copies < 2 && random.chance(0.15);
      if (stands) copies++;
      const next = `b${row}_${step}`;
      body.push(`const ${next} = ${random.pick(stands ? standsForIt : sameObject)(holder)};`);
      holder = next;
    }
    const uses = random.between(1, 4);
    for (let use = 0; use < uses; use++) {
      const [name, probe] = random.pick(members);
      const label = `${row}.${use} ${name}`;
      if (random.chance(0.3)) {
        body.push(
          `try {\nlines.push("${label} asked: " + show(${random.pick(asks)(holder, name)}));\n} catch (error) {\nlines.push("${label} asked: threw " + error.name);\n}`,
        );
        continue;
      }
      body.push(
        `try {\n${random.pick(takes)(holder, name)}\nlines.push("${label}: " + typeof member);\nlines.push("${label}: " + show(${probe}));\n} catch (error) {\nlines.push("${label}: threw " + error.name);\n}`,
      );
    }
    text.push(random.chance(0.5) ? body.join("\n") : `await (async () => {\n${body.join("\n")}\n})();`);
  }
  text.push(`console.log(lines.join("\\n"));`);
  return text.join("\n") + "\n";
}
