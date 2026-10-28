// <this file> --names: the names of the programs, as JSON. <this file> --text <name>: one program.
// Each expression calls a built-in that makes an object. The script evaluates it and takes the own names of the object, and of the objects that it holds. The program evaluates it too and reads
// each of those names by a member access of its own, inside a function without types, so that nothing but the compiler's own knowledge of the built-in says what the read finds.
// It prints the type of each member and whether it is undefined.
const modules: Record<string, string> = {
  path: "node:path",
  fs: "node:fs",
  os: "node:os",
  util: "node:util",
  url: "node:url",
  querystring: "node:querystring",
  EventEmitter: "node:events",
  v8: "node:v8",
  assert: "node:assert",
  stream: "node:stream",
  crypto: "node:crypto",
  net: "node:net",
  perf_hooks: "node:perf_hooks",
  http: "node:http",
  string_decoder: "node:string_decoder",
};

const expressions: Record<string, string> = {
  exec: `/(?<n>a)/.exec("a")`,
  execIndices: `/(?<n>a)/d.exec("a")`,
  match: `"a".match(/(?<n>a)/)`,
  matchAll: `[..."ab".matchAll(/(?<x>a)/g)][0]`,
  matchAllStep: `"ab".matchAll(/a/g).next()`,
  descriptor: `Object.getOwnPropertyDescriptor({ a: { d: 1 } }, "a")`,
  accessorDescriptor: `Object.getOwnPropertyDescriptor({ get a() { return 1; } }, "a")`,
  reflectDescriptor: `Reflect.getOwnPropertyDescriptor({ a: { d: 1 } }, "a")`,
  descriptors: `Object.getOwnPropertyDescriptors({ a: { d: 1 }, get b() { return 1; } })`,
  functionDescriptors: `Object.getOwnPropertyDescriptors(function f(a) {})`,
  entriesPair: `Object.entries({ a: { d: 1 } })[0]`,
  fromEntries: `Object.fromEntries([["a", { d: 1 }]])`,
  groupBy: `Object.groupBy([1, 2], x => (x % 2 ? "odd" : "even"))`,
  allSettled: `await Promise.allSettled([{ d: 1 }, Promise.reject({ e: 1 })])`,
  withResolvers: `Promise.withResolvers()`,
  revocable: `Proxy.revocable({}, {})`,
  error: `new Error("x", { cause: { d: 1 } })`,
  typeError: `new TypeError("x", { cause: { d: 1 } })`,
  aggregate: `new AggregateError([{ d: 1 }], "m", { cause: { d: 1 } })`,
  suppressed: `new SuppressedError({ d: 1 }, { e: 1 }, "m")`,
  thrown: `(() => { try { null.x; } catch (e) { return e; } })()`,
  arrayStep: `[{ d: 1 }].entries().next()`,
  mapStep: `new Map([[1, { d: 1 }]]).entries().next()`,
  generatorStep: `(function* () { yield { d: 1 }; })().next()`,
  split: `"a,b".split(",")`,
  arrayFrom: `Array.from({ length: 1, 0: { d: 1 } })`,
  template: `(t => t)\`a\${1}b\``,
  resolvedOptions: `new Intl.DateTimeFormat("en").resolvedOptions()`,
  numberParts: `new Intl.NumberFormat("en").formatToParts(1)`,
  segment: `[...new Intl.Segmenter("en", { granularity: "word" }).segment("a b")][0]`,
  pluralOptions: `new Intl.PluralRules("en").resolvedOptions()`,
  jsonParse: `JSON.parse('{"a":{"b":1},"l":[{"c":1}]}')`,
  clone: `structuredClone({ a: { b: 1 }, e: new Error("x") })`,
  newFunction: `new Function("a", "return a")`,
  bound: `function f(a) {}.bind(null)`,
  regexp: `new RegExp("a", "g")`,
  stringObject: `new String("ab")`,
  objectOfString: `Object("ab")`,
  arguments: `(function () { return arguments; })({ d: 1 }, 2)`,
  strictArguments: `(function () { "use strict"; return arguments; })({ d: 1 }, 2)`,
  typedArray: `new Uint8Array(2)`,
  encodeInto: `new TextEncoder().encodeInto("a", new Uint8Array(2))`,
  event: `new Event("x")`,
  customEvent: `new CustomEvent("x", { detail: { d: 1 } })`,
  messageChannel: `new MessageChannel()`,
  abortController: `new AbortController()`,
  pathParse: `path.parse("/a/b.c")`,
  urlParse: `url.parse("http://a.b/c?d=1", true)`,
  httpOptions: `url.urlToHttpOptions(new URL("http://u:p@a.b/c?d=1"))`,
  stat: `fs.statSync(".")`,
  bigStat: `fs.statSync(".", { bigint: true })`,
  dirent: `fs.readdirSync("/", { withFileTypes: true })[0]`,
  cpus: `os.cpus()[0]`,
  memoryUsage: `process.memoryUsage()`,
  cpuUsage: `process.cpuUsage()`,
  resourceUsage: `process.resourceUsage()`,
  hrtime: `process.hrtime()`,
  release: `process.release`,
  parseArgs: `util.parseArgs({ args: ["-a", "b"], options: { a: { type: "boolean", short: "a" } }, allowPositionals: true, tokens: true })`,
  querystring: `querystring.parse("a=1&a=2&b=3")`,
  bufferJSON: `Buffer.from("a").toJSON()`,
  emitter: `new EventEmitter()`,
  heapStatistics: `v8.getHeapStatistics()`,
  assertionError: `new assert.AssertionError({ actual: { d: 1 }, expected: { e: 1 }, operator: "strictEqual" })`,
  failedAssert: `(() => { try { assert.strictEqual(1, 2); } catch (e) { return e; } })()`,
  systemError: `(() => { try { fs.readFileSync("/does/not/exist"); } catch (e) { return e; } })()`,
  timeout: `(() => { const t = setTimeout(() => {}, 1); clearTimeout(t); return t; })()`,
  immediate: `(() => { const t = setImmediate(() => {}); clearImmediate(t); return t; })()`,
  readable: `new stream.Readable({ read() {} })`,
  passThrough: `new stream.PassThrough()`,
  color: `Bun.color("red", "{rgb}")`,
  toml: `Bun.TOML.parse("a = 1\\n[b]\\nc = 2")`,
  glob: `new Bun.Glob("*")`,
  mark: `performance.mark("a")`,
  measure: `performance.measure("b")`,
  hash: `crypto.createHash("sha1")`,
  keyPair: `crypto.generateKeyPairSync("ed25519")`,
  socketAddress: `new net.SocketAddress({ address: "127.0.0.1", port: 1 })`,
  server: `http.createServer()`,
  agent: `new http.Agent()`,
  decoder: `new string_decoder.StringDecoder("utf8")`,
  histogram: `perf_hooks.createHistogram()`,
  inspectDefaults: `util.inspect.defaultOptions`,
  callSites: `util.getCallSites()[0]`,
  mimeType: `new util.MIMEType("text/plain;a=b")`,
  domException: `new DOMException("m", "AbortError")`,
  abortReason: `AbortSignal.abort().reason`,
  response: `new Response("x")`,
  blob: `new Blob(["x"])`,
  file: `new File(["x"], "n")`,
  bunFile: `Bun.file("/does/not/exist")`,
  formData: `new FormData()`,
  headersJSON: `new Headers({ a: "b" }).toJSON()`,
  cookie: `new Bun.Cookie("a", "b").toJSON()`,
  weakRef: `new WeakRef({ d: 1 })`,
  iteratorFrom: `Iterator.from([1]).take(1).next()`,
  arrayWith: `[{ d: 1 }].with(0, { e: 1 })`,
  toSorted: `[{ d: 1 }].toSorted()`,
  flat: `[[{ d: 1 }]].flat()`,
  dateParts: `new Intl.DateTimeFormat("en").formatToParts(0)[0]`,
  listParts: `new Intl.ListFormat("en").formatToParts(["a", "b"])[0]`,
  relativeParts: `new Intl.RelativeTimeFormat("en").formatToParts(1, "day")[0]`,
  locale: `new Intl.Locale("en-US").getWeekInfo?.() ?? {}`,
  durationOptions: `new Intl.DurationFormat("en").resolvedOptions()`,
};

const isIdentifier = (key: string) => /^[A-Za-z_$][\w$]*$/.test(key);
const member = (object: string, key: string) =>
  isIdentifier(key) ? `${object}.${key}` : `${object}[${JSON.stringify(key)}]`;
const isObject = (value: unknown): value is object => Object(value) === value;
const usedBy = (expression: string) =>
  Object.keys(modules).filter(name => new RegExp(`\\b${name}\\b`).test(expression));

async function textOf(name: string): Promise<string> {
  const expression = expressions[name];
  const used = usedBy(expression);
  const AsyncFunction = (async () => {}).constructor as new (
    ...text: string[]
  ) => (...operands: unknown[]) => Promise<unknown>;
  const made = await new AsyncFunction(...used, `return (${expression});`)(
    ...(await Promise.all(used.map(async module => (await import(modules[module])).default))),
  );
  const reads: string[] = [];
  for (const key of isObject(made) ? Object.getOwnPropertyNames(made).slice(0, 40) : []) {
    reads.push(member("made", key));
    let held: unknown;
    try {
      held = (made as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (isObject(held))
      for (const inner of Object.getOwnPropertyNames(held).slice(0, 12)) reads.push(member(member("made", key), inner));
  }
  return [
    ...used.map(module => `import ${module} from ${JSON.stringify(modules[module])};`),
    `const made = ${expression};`,
    'const typeOf = value => (value === null ? "null" : typeof value);',
    ...reads.flatMap((read, index) => [
      `function read${index}(made) {`,
      `  return ${read};`,
      "}",
      "try {",
      `  console.log(${JSON.stringify(read)}, typeOf(read${index}(made)), read${index}(made) === undefined);`,
      "} catch {",
      `  console.log(${JSON.stringify(read)}, "threw");`,
      "}",
    ]),
    "",
  ].join("\n");
}

if (process.argv[2] === "--names") console.log(JSON.stringify(Object.keys(expressions)));
else process.stdout.write(await textOf(process.argv[3]));
process.exit(0);
