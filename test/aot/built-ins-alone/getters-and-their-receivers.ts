// The compiler takes a getter of the table of built-ins to leave its receiver with the own keys it had, unless the row of the getter says otherwise. Here every getter of every prototype object
// that can be reached is read in three ways: on an instance, on a plain object that is laid below the prototype, and by Reflect.get() with a plain object as the receiver. The own keys of the
// receiver are taken before and after.
//
//   bun --expose-internals getters-and-their-receivers.ts <aot_builtin_table.json>      the last line that it prints is `GettersFound` below, as JSON
import { bodyOf, within } from "./evaluate";
import { Judge } from "./fresh-results";
import { calls } from "./fresh-results-calls";
import { classSamples, itemSetup } from "./samples";
import { readTable, type Overload } from "./table";

const temporary =
  'import { mkdtempSync } from "node:fs";\nimport { tmpdir } from "node:os";\nconst folder = mkdtempSync(tmpdir() + "/getters-");\nawait Bun.write(folder + "/a.js", "export default 1;");';

/** Instances of classes that neither ./samples.ts nor ./fresh-results-calls.ts makes. The last line is the expression. */
const otherInstances = [
  'import { statSync } from "node:fs";\nstatSync(".")',
  'import { statSync } from "node:fs";\nstatSync(".", { bigint: true })',
  'import { statfsSync } from "node:fs";\nstatfsSync(".")',
  'import { readdirSync } from "node:fs";\nreaddirSync("/", { withFileTypes: true })[0]',
  'import { opendirSync } from "node:fs";\nconst folder = opendirSync("/");\nfolder.closeSync();\nfolder',
  'new File(["a"], "n")',
  "new FormData()",
  'new MessageEvent("x", { data: { a: 1 }, ports: [] })',
  'new CustomEvent("x", { detail: { a: 1 } })',
  'new ErrorEvent("x", { error: { a: 1 } })',
  'new CloseEvent("x")',
  "new MessageChannel()",
  "new MessageChannel().port1",
  'new DOMException("m", "AbortError")',
  'performance.mark("a")',
  'performance.measure("b")',
  "new PerformanceObserver(() => {})",
  'new Bun.Cookie("a", "b")',
  'new Bun.CookieMap("a=b")',
  'Bun.spawn(["true"], { stdout: "pipe", stderr: "pipe", stdin: "pipe" })',
  'Bun.spawnSync(["true"]).resourceUsage',
  "new ReadableStream({ start() {} }).getReader()",
  "new WritableStream().getWriter()",
  "new TextDecoderStream()",
  'new URLPattern({ pathname: "/a" })',
  'import { createHash } from "node:crypto";\ncreateHash("sha1")',
  'import { createSecretKey } from "node:crypto";\ncreateSecretKey(Buffer.from("a"))',
  'import { rootCertificates } from "node:tls";\nimport { X509Certificate } from "node:crypto";\nnew X509Certificate(rootCertificates[0])',
  'import { Script } from "node:vm";\nnew Script("1")',
  'import { MIMEType } from "node:util";\nnew MIMEType("text/plain;a=b")',
  `${temporary}\n(await Bun.build({ entrypoints: [folder + "/a.js"] })).outputs[0]`,
  `${temporary}\nnew Bun.FileSystemRouter({ style: "nextjs", dir: folder }).match("/a")`,
  'await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign"])',
  'new Bun.S3Client({}).file("a")',
];

/** The message of the TypeError for a receiver that is no Script prints the receiver, which inherits the getter. */
const isNotReadOnPlainObject = (path: string) => /\bScript\.prototype$/.test(path);

const isObject = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";
const nameOfKey = (key: string | symbol) =>
  typeof key === "symbol" ? `@@${(key.description ?? "").replace(/^Symbol\./, "")}` : key;

const AsyncFunction = async function () {}.constructor as new (
  ...text: string[]
) => (load: unknown) => Promise<unknown>;

/** The value of the last line of `text`, in a list: a promise stays a promise. */
async function valueOf(text: string): Promise<[unknown]> {
  const statements = text.split("\n");
  const body = bodyOf([...statements.slice(0, -1), `return [${statements.at(-1)}];`].join("\n"));
  try {
    const made = await within<unknown>(
      new AsyncFunction("load", body)((name: string) => require(name)),
      [],
      10000,
    );
    const [value] = made as [unknown];
    if (value instanceof Promise) value.catch(() => {});
    return [value];
  } catch {
    return [undefined];
  }
}

export interface GettersFound {
  read: number;
  /** Each read that left its receiver with more own keys. `rowSaysSo` is null where the table has no row for the getter. */
  added: { path: string; rowSaysSo: boolean | null; names: string[]; on: "instance" | "plain" | "reflect" }[];
}

function saysItChangesReceiver(row: Overload): boolean {
  return (
    row.isUndeclared ||
    row.propertyActions.some(
      action =>
        ["DefinesName", "StoresByKey", "DefinesFrom", "DefinesGetter"].includes(action.action) &&
        action.object === "this",
    ) ||
    (row.receiver?.uses ?? []).some(use => use !== "Inspects" && use !== "ReadsContents")
  );
}

export async function readEveryGetter(tablePath: string): Promise<GettersFound> {
  const judge = new Judge(readTable(tablePath) as never);
  const prototypes = new Map<object, { path: string; token: string | null; instance: unknown }>();
  const listedIn = (token: string) =>
    (judge.members.get(token) ?? []).map(member => (member.isSymbolName ? `@@${member.name}` : member.name));
  const hidden = [...judge.entries.values()].filter(entry => entry.kind === "Prototype" && entry.path.startsWith("%"));
  for (const entry of judge.entries.values()) {
    if (entry.kind !== "Prototype" || /^(%|native:)/.test(entry.path)) continue;
    const reached = judge.reach(entry.path);
    if (isObject(reached) && !prototypes.has(reached))
      prototypes.set(reached, { path: entry.path, token: entry.token, instance: undefined });
  }
  // A prototype of the table that no path reaches is told by the members that the table lists for it: the entry with the most, all of which it has.
  const named = (prototype: object) => {
    const own = new Set(Reflect.ownKeys(prototype).map(nameOfKey));
    let best: { path: string; token: string | null } | null = null;
    let most = 0;
    for (const entry of hidden) {
      const listed = listedIn(entry.token);
      if (listed.length <= most || !listed.every(name => own.has(name))) continue;
      most = listed.length;
      best = { path: entry.path, token: entry.token };
    }
    if (best !== null && most >= Math.min(own.size - 2, 3)) return best;
    const constructor = (prototype as { constructor?: { name?: string } }).constructor;
    return { path: `${constructor?.name ?? "?"}.prototype`, token: null };
  };
  const texts = [
    ...otherInstances,
    ...Object.values(calls).flat(),
    ...Object.values(classSamples).map(sample =>
      [...itemSetup, ...(sample.setup ?? []), sample.make(sample.base)].join("\n"),
    ),
  ];
  for (const text of texts) {
    const [instance] = await valueOf(text);
    if (!isObject(instance)) continue;
    for (
      let above = Object.getPrototypeOf(instance);
      above !== null && above !== Object.prototype && above !== Function.prototype;
      above = Object.getPrototypeOf(above)
    ) {
      if (!prototypes.has(above)) prototypes.set(above, { ...named(above), instance });
      prototypes.get(above)!.instance ??= instance;
    }
  }

  const found: GettersFound = { read: 0, added: [] };
  for (const [prototype, { path, token, instance }] of prototypes) {
    for (const key of Reflect.ownKeys(prototype)) {
      if (typeof Object.getOwnPropertyDescriptor(prototype, key)!.get !== "function") continue;
      found.read++;
      const rows = (judge.members.get(token ?? "") ?? [])
        .find(member => (member.isSymbolName ? `@@${member.name}` : member.name) === nameOfKey(key))
        ?.overloads.filter(row => row.mode === "Get");
      const below = Object.setPrototypeOf({ a: 1 }, prototype) as Record<PropertyKey, unknown>;
      const other = { a: 1 };
      const reads: ["instance" | "plain" | "reflect", object | null, () => unknown][] = [
        ["instance", isObject(instance) ? instance : null, () => (instance as Record<PropertyKey, unknown>)[key]],
        ["plain", isNotReadOnPlainObject(path) ? null : below, () => below[key]],
        ["reflect", other, () => Reflect.get(prototype, key, other)],
      ];
      for (const [on, receiver, read] of reads) {
        if (receiver === null) continue;
        const before = new Set(Reflect.ownKeys(receiver));
        try {
          const value = read();
          if (value instanceof Promise) value.catch(() => {});
        } catch {}
        const names = Reflect.ownKeys(receiver)
          .filter(each => !before.has(each))
          .map(nameOfKey);
        if (names.length > 0)
          found.added.push({
            path: `${path}.${nameOfKey(key)}`,
            rowSaysSo: rows === undefined ? null : rows.some(saysItChangesReceiver),
            names,
            on,
          });
      }
    }
  }
  return found;
}

if (import.meta.main) {
  console.log(`\n${JSON.stringify(await readEveryGetter(process.argv[2]))}`);
  process.exit(0);
}
