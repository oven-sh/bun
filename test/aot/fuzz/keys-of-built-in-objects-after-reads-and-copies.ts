// The own keys of a built-in object stand in one order, whatever the program did with the object before. A program takes 1 to 3 objects
// of the language, Bun, Node.js or the web. On each it does 2 to 8 things: it reads members by name, in brackets or through a
// pattern, asks for them with `in`, Object.hasOwn and descriptors, copies the object with a spread, a rest pattern or Object.assign (into a new,
// a frozen, a sealed object or an instance of a class), adds a member of its own and deletes it again. After each step it lists
// the keys with Object.keys, Reflect.ownKeys, Object.getOwnPropertyNames, for-in or Object.entries, of the object or of the copy. The
// steps stand at the top of the module, in a function, or in a function that a loop calls many times. Where `readsForNothing` is set, half
// of the steps read a member where nothing takes its value or only a test does: under typeof or void, as a statement, to the left of a comma,
// under `!`, beside `&&`, `||` and `??`, in front of `?`, or compared with undefined or null.
import type { Random } from "./random";

const objects: [string, string[]][] = [
  [
    "process",
    [
      "pid",
      "title",
      "version",
      "versions",
      "arch",
      "platform",
      "argv",
      "env",
      "exit",
      "nextTick",
      "cwd",
      "hrtime",
      "uptime",
      "memoryUsage",
      "emitWarning",
      "exitCode",
    ],
  ],
  [
    "Bun",
    [
      "version",
      "revision",
      "env",
      "argv",
      "main",
      "hash",
      "sleep",
      "sleepSync",
      "file",
      "write",
      "inspect",
      "gc",
      "nanoseconds",
      "which",
      "semver",
      "escapeHTML",
    ],
  ],
  ["console", ["log", "error", "warn", "info", "debug", "table", "trace", "assert", "count", "time", "group"]],
  ["Math", ["abs", "PI", "max", "floor", "E", "imul", "hypot", "sign", "trunc"]],
  ["JSON", ["parse", "stringify", "rawJSON", "isRawJSON"]],
  ["Reflect", ["get", "ownKeys", "apply", "has", "set", "construct"]],
  ["Atomics", ["add", "load", "store", "wait", "notify"]],
  ["Intl", ["DateTimeFormat", "NumberFormat", "Collator", "getCanonicalLocales", "supportedValuesOf"]],
  ["Buffer", ["from", "alloc", "byteLength", "concat", "isBuffer", "poolSize", "compare", "isEncoding"]],
  ["performance", ["now", "timeOrigin", "mark", "measure", "toJSON"]],
  ["crypto", ["subtle", "randomUUID", "getRandomValues", "timingSafeEqual"]],
  ["navigator", ["userAgent", "platform", "hardwareConcurrency"]],
  ["process.versions", ["bun", "node", "v8", "uv", "zlib", "modules"]],
  ["process.release", ["name", "sourceUrl", "headersUrl"]],
  ["process.features", ["typescript", "ipv6", "tls", "inspector"]],
  ["process.memoryUsage", ["rss", "name", "length"]],
  ["process.hrtime", ["bigint", "name", "length"]],
  ["Bun.hash", ["crc32", "adler32", "wyhash", "xxHash32", "name", "length"]],
  ["Bun.semver", ["order", "satisfies"]],
  ["Bun.password", ["hash", "verify", "hashSync", "verifySync"]],
  ["Bun.inspect", ["custom", "table", "name", "length"]],
  ["Bun.unsafe", ["arrayBufferToString", "gcAggressionLevel"]],
  ["Symbol", ["iterator", "asyncIterator", "for", "keyFor", "hasInstance", "toPrimitive"]],
  ["Object", ["keys", "assign", "freeze", "entries", "create", "groupBy", "hasOwn"]],
  ["Array", ["from", "of", "isArray", "fromAsync"]],
  ["Number", ["MAX_SAFE_INTEGER", "EPSILON", "isInteger", "parseFloat", "isNaN"]],
  ["String", ["raw", "fromCharCode", "fromCodePoint"]],
  ["Promise", ["all", "race", "resolve", "withResolvers", "try", "any"]],
  ["Date", ["now", "UTC", "parse"]],
  ["Response", ["json", "error", "redirect"]],
  ["URL", ["canParse", "parse", "createObjectURL"]],
  ["Array.prototype", ["map", "at", "push", "flat", "length", "toSorted", "includes"]],
  ["Map.prototype", ["get", "set", "size", "forEach", "getOrInsert"]],
  ["Promise.prototype", ["then", "catch", "finally"]],
  ["Response.prototype", ["json", "text", "status", "headers", "ok", "clone"]],
  ["URL.prototype", ["href", "host", "searchParams", "toJSON"]],
  ["Buffer.prototype", ["toString", "write", "readUInt8", "equals", "slice", "parent"]],
  ["Uint8Array.prototype", ["toHex", "toBase64", "BYTES_PER_ELEMENT", "constructor"]],
];

const readsForNothing: ((member: string) => string)[] = [
  member => `typeof ${member}; return "read";`,
  member => `void ${member}; return "read";`,
  member => `${member}; return "read";`,
  member => `return String((${member}, 1));`,
  member => `return String(void ${member});`,
  member => `if (${member}) return "yes"; return "no";`,
  member => `return String(!${member});`,
  member => `return String((${member} && 1) === 1);`,
  member => `return String((${member} || 1) === 1);`,
  member => `return String((${member} ?? 1) === 1);`,
  member => `return ${member} ? "yes" : "no";`,
  member => `return String(${member} === undefined);`,
  member => `return String(${member} != null);`,
  member => `return String(typeof ${member} === "function");`,
];

export function generate(random: Random, typed: boolean, readsMembersForNothing = false): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const any = typed ? " as any" : "";
  const out: string[] = [
    `function names(keys${as("(string | symbol)[]")})${as("string")} {`,
    `  return keys.length + " " + keys.map(key => String(key)).join();`,
    `}`,
    `function walked(object${as("any")})${as("string[]")} {`,
    `  const keys = [];`,
    `  for (const key in object) keys.push(key);`,
    `  return keys;`,
    `}`,
    `let quiet = false;`,
    `function attempt(label${as("string")}, run${as("() => string")})${as("void")} {`,
    `  let text;`,
    `  try {`,
    `    text = run();`,
    `  } catch (error) {`,
    `    text = "throws " + (error${typed ? " as Error" : ""}).name;`,
    `  }`,
    `  if (!quiet) console.log(label, text);`,
    `}`,
    `class Holder {`,
    `  first = 1;`,
    `}`,
  ];
  const headerLength = out.length;
  let usesCopied = false;
  random.sample(objects, random.between(1, 3)).forEach(([path, members], index) => {
    const body: string[] = [];
    const object = random.chance(0.7) ? path : `o${index}`;
    const it = typed ? `(${object} as any)` : object;
    const closed = /\.prototype$|^process\.(release|versions|features)$/.test(path);
    let copies = 0;
    // Reading an accessor on the prototype itself can throw, so a prototype is copied where the error is caught.
    const declareCopy = (name: string, expression: string) => {
      if (!path.endsWith(".prototype")) return `const ${name} = ${expression};`;
      usesCopied = true;
      return `const ${name} = copied(() => ${expression.startsWith("{") ? `(${expression})` : expression});`;
    };
    const listed = (what: string) =>
      random.weighted<string>([
        [3, `names(Object.keys(${what}))`],
        [4, `names(Reflect.ownKeys(${what}))`],
        [2, `names(Object.getOwnPropertyNames(${what}))`],
        [1, `names(walked(${what}))`],
        [1, `names(Object.entries(${what}).map(([key]) => key))`],
        [1, `names(Object.keys(Object.getOwnPropertyDescriptors(${what})))`],
      ]);
    const steps = random.between(2, 8);
    for (let step = 0; step < steps; step++) {
      const key = random.pick(members);
      const label = JSON.stringify(`${path} ${step}`);
      // A compiled program may not change prototypes of built-in classes and the constant lists of process: there it only reads and copies.
      const drawn = random.between(0, readsMembersForNothing ? 27 : 13);
      const kind = closed && (drawn === 4 || (drawn >= 10 && drawn <= 12)) ? drawn % 4 : drawn;
      let copy = "";
      if (kind > 13)
        body.push(
          `attempt(${label}, () => { ${readsForNothing[kind - 14](random.chance(0.8) ? `${it}.${key}` : `${it}[${JSON.stringify(key)}]`)} });`,
        );
      else if (kind === 0) body.push(`attempt(${label}, () => typeof ${it}.${key});`);
      else if (kind === 1) body.push(`attempt(${label}, () => typeof ${it}[${JSON.stringify(key)}]);`);
      else if (kind === 2)
        body.push(`attempt(${label}, () => { const { ${key}: found } = ${it}; return typeof found; });`);
      else if (kind === 3)
        body.push(
          `attempt(${label}, () => String(${JSON.stringify(key)} in ${it}) + Object.hasOwn(${it}, ${JSON.stringify(key)}));`,
        );
      else if (kind === 4)
        body.push(
          `attempt(${label}, () => { const own = Object.getOwnPropertyDescriptor(${it}, ${JSON.stringify(key)}); return own ? ("value" in own ? "value" : "accessor") + own.enumerable + own.configurable : "none"; });`,
        );
      else if (kind === 5) body.push(declareCopy(`c${index}_${(copy = String(copies++))}`, `{ ...${it} }`));
      else if (kind === 6 && path.endsWith(".prototype"))
        body.push(
          declareCopy(
            `c${index}_${(copy = String(copies++))}`,
            `(({ ${key}: taken, ...rest }${as("any")}) => rest)(${it})`,
          ),
        );
      else if (kind === 6)
        body.push(`const { ${key}: taken${index}_${copies}, ...c${index}_${(copy = String(copies++))} } = ${it};`);
      else if (kind === 7) body.push(declareCopy(`c${index}_${(copy = String(copies++))}`, `Object.assign({}, ${it})`));
      else if (kind === 8)
        body.push(declareCopy(`c${index}_${(copy = String(copies++))}`, `Object.assign(new Holder(), ${it})`));
      else if (kind === 9)
        body.push(
          `const c${index}_${(copy = String(copies++))}${as("any")} = ${random.pick(["Object.freeze({})", "Object.seal({})", "Object.preventExtensions({})"])};`,
          `attempt(${label}, () => typeof Object.assign(c${index}_${copy}, ${it}));`,
        );
      else if (kind === 10)
        body.push(
          `attempt(${label}, () => { ${it}.addedByTheProgram = ${step}; return typeof ${it}.addedByTheProgram; });`,
        );
      else if (kind === 11) body.push(`attempt(${label}, () => String(delete ${it}.addedByTheProgram));`);
      else if (kind === 12)
        body.push(
          `attempt(${label}, () => String(Object.isFrozen(${it})) + Object.isSealed(${it}) + Object.isExtensible(${it}));`,
        );
      else
        body.push(
          `attempt(${label}, () => String(Object.keys(${it}).includes(${JSON.stringify(key)})) + Object.prototype.propertyIsEnumerable.call(${it}, ${JSON.stringify(key)}));`,
        );
      if (copy !== "" && random.chance(0.7))
        body.push(`attempt(${label} + " copy", () => ${listed(`c${index}_${copy}`)});`);
      if (random.chance(0.6) || step === steps - 1) body.push(`attempt(${label} + " keys", () => ${listed(it)});`);
    }
    if (object !== path) out.push(`const o${index} = ${path}${any};`);
    const place = random.between(0, 3);
    if (place <= 1) out.push(...body);
    else if (place === 2)
      out.push(`function steps${index}()${as("void")} {`, ...body.map(line => "  " + line), `}`, `steps${index}();`);
    else
      out.push(
        `function steps${index}(turn${as("number")})${as("void")} {`,
        `  quiet = turn < 29;`,
        ...body.map(line => "  " + line),
        `}`,
        `for (let turn = 0; turn < 30; turn++) steps${index}(turn);`,
      );
  });
  if (usesCopied)
    out.splice(
      headerLength,
      0,
      `function copied(copy${as("() => any")})${as("any")} {`,
      `  try {`,
      `    return copy();`,
      `  } catch (error) {`,
      `    return { thrown: (error${typed ? " as Error" : ""}).name };`,
      `  }`,
      `}`,
    );
  return out.join("\n") + "\n";
}
