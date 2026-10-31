import { jscDescribe } from "bun:jsc";
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { slot } from "./harness/commands";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { beforeAll, eachRow, gap, test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(240_000);

// Compiled code calls URL.canParse, AbortSignal.abort and Bun.pathToFileURL without a test, so a write to one of them that the build does not follow is refused: it throws.
// The object is the same whichever way a program comes to it, so the answer has to be the same too. The global object adds `URL`, `AbortSignal` and `Bun` at the first read
// of the name, and `url.constructor`, the exports of a module and require("bun") never read it. The host reports each such object where it makes it.

// For each holder: what the program makes before the write, and how the text of the write names the holder.
const ways: Record<string, [way: string, made: string, object: string][]> = {
  "URL": [
    ["the global name", "nothing", "URL"],
    ["the constructor of an instance", "a URL", "held.constructor"],
    ["the constructor of an instance, the name read first", "the name URL, then a URL", "held.constructor"],
    ["the constructor of the prototype of an instance", "a URL", "Object.getPrototypeOf(held).constructor"],
  ],
  "AbortSignal": [
    ["the global name", "nothing", "AbortSignal"],
    ["the constructor of an instance", "a signal", "held.constructor"],
    ["the constructor of the prototype of an instance", "a signal", "Object.getPrototypeOf(held).constructor"],
    ["the export of a module", "the exports of abort-controller", "held.AbortSignal"],
  ],
  // A constructor is locked with what hangs on it.
  "AbortSignal.prototype": [
    ["the global name", "nothing", "AbortSignal.prototype"],
    ["the prototype of the constructor of an instance", "a signal", "held.constructor.prototype"],
  ],
  "ReadableStream": [
    ["the global name", "nothing", "ReadableStream"],
    ["the constructor of an instance", "a stream", "held.constructor"],
  ],
  "SubtleCrypto": [
    ["the global name", "nothing", "SubtleCrypto"],
    ["the constructor of an instance", "crypto.subtle", "held.constructor"],
  ],
  "Bun": [
    ["the global name", "nothing", "Bun"],
    ["require()", "the exports of bun", "held"],
    ["require() in the text of the write", "the function require", 'load("bun")'],
  ],
};
// Each with what it answers as the host made it.
const members: Record<string, string> = {
  "URL.canParse": "true",
  "URL.parse": "x:y",
  "URL.createObjectURL": "blob:",
  "AbortSignal.abort": "[object AbortSignal]",
  "AbortSignal.any": "[object AbortSignal]",
  "AbortSignal.timeout": "[object AbortSignal]",
  "AbortSignal.prototype.throwIfAborted": "undefined",
  "ReadableStream.from": "[object ReadableStream]",
  "SubtleCrypto.supports": "true",
  "Bun.pathToFileURL": "file:///a",
};
const writes = ["a store", "a store by new Function", "a definition", "a deletion"];
const holderOf = (member: string) => member.slice(0, member.lastIndexOf("."));
const refusal = (member: string, write: string, answer = members[member]) =>
  `TypeError: Cannot ${write === "a deletion" ? "delete" : "assign to"} ${member} | ${answer}`;

const cases = Object.keys(members).flatMap(member =>
  ways[holderOf(member)].flatMap(([way, made, object]) =>
    writes
      // Plain Bun does not delete a member of `Bun` either.
      .filter(write => !(member.startsWith("Bun.") && write === "a deletion"))
      .map(write => ({ member, way, write, words: [made, object, write, member] })),
  ),
);

// The way and the write come from the command line, and the text of the write is put together when the program runs: the build follows none of it.
const program = `
const [, , made, object, write, member] = process.argv;
const bytes = () => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const makers = {
  "nothing": () => undefined,
  "a URL": () => Bun.pathToFileURL("/a"),
  "the name URL, then a URL": () => ((globalThis.kept = URL), Bun.pathToFileURL("/a")),
  "a signal": () => new AbortController().signal,
  "a stream": () => new Blob(["x"]).stream(),
  "crypto.subtle": () => crypto.subtle,
  "an instant": () => Temporal.Now.instant(),
  "a module of WebAssembly": async () => (await WebAssembly.instantiate(bytes())).module,
  "the exports of abort-controller": () => import.meta.require("abort-controller"),
  "the exports of bun": () => import.meta.require("bun"),
  "the function require": () => ((globalThis.load = import.meta.require), undefined),
};
globalThis.held = await makers[made]();
const key = JSON.stringify(member.slice(member.lastIndexOf(".") + 1));
const texts = {
  "a store": object + "[" + key + '] = () => "mine"',
  "a store by new Function": object + "[" + key + '] = () => "mine"',
  "a definition": "Object.defineProperty(" + object + ", " + key + ', { value: () => "mine" })',
  "a deletion": "delete " + object + "[" + key + "]",
};
let how = "written";
try {
  if (write === "a store by new Function") new Function(texts[write])();
  else (0, eval)(texts[write]);
} catch (error) {
  how = error.constructor.name + ": " + String(error.message).split(" because ")[0];
}
const calls = {
  "URL.canParse": () => URL.canParse("x:y"),
  "URL.parse": () => URL.parse("x:y"),
  "URL.createObjectURL": () => URL.createObjectURL(new Blob(["x"])).slice(0, 5),
  "AbortSignal.abort": () => AbortSignal.abort(),
  "AbortSignal.any": () => AbortSignal.any([]),
  "AbortSignal.timeout": () => AbortSignal.timeout(1000),
  "AbortSignal.prototype.throwIfAborted": () => new AbortController().signal.throwIfAborted(),
  "ReadableStream.from": () => ReadableStream.from([1]),
  "SubtleCrypto.supports": () => SubtleCrypto.supports("digest", "SHA-256"),
  "Bun.pathToFileURL": () => Bun.pathToFileURL("/a"),
  "Temporal.Instant.compare": () => Temporal.Instant.compare(Temporal.Instant.fromEpochMilliseconds(1), Temporal.Instant.fromEpochMilliseconds(2)),
  "WebAssembly.Module.exports": () => WebAssembly.Module.exports(new WebAssembly.Module(bytes())).length,
};
let answer;
try {
  answer = String(calls[member]());
} catch (error) {
  answer = error.constructor.name;
}
console.log("ANSWER", how, "|", answer);
process.exit(0);
`;

// The receiver of the store is a value that the build cannot follow, and no text is evaluated.
const hidden = `
const hide = value => new CustomEvent("x", { detail: value }).detail;
let how = "written";
try {
  hide(Bun.pathToFileURL("/a")).constructor.canParse = () => "mine";
} catch (error) {
  how = error.constructor.name + ": " + String(error.message).split(" because ")[0];
}
console.log("ANSWER", how, "|", String(URL.canParse("x:y")));
`;

// The build follows this store, so it takes URL.canParse for no constant.
const followed = `
const url = Bun.pathToFileURL("/a");
url.constructor.canParse = () => "mine";
console.log("ANSWER", "written", "|", String(URL.canParse("x:y")));
`;

// The build follows these stores to the names, as it follows a polyfill, so the names no longer lead to the constructors. An instance still does.
const named = `
const [, , order, name, text] = process.argv;
class Other {
  static canParse() {
    return "other";
  }
  static abort() {
    return "other";
  }
}
const storeTheNames = () => {
  globalThis.URL = Other;
  globalThis.AbortSignal = Other;
};
if (order === "the name written first") storeTheNames();
const url = Bun.pathToFileURL("/a");
const signal = new AbortController().signal;
globalThis.held = name === "URL" ? url : signal;
const constructors = [url.constructor, signal.constructor];
if (order === "the constructor made first") storeTheNames();
let how = "written";
try {
  (0, eval)(text);
} catch (error) {
  how = error.constructor.name + ": " + String(error.message).split(" because ")[0];
}
let answer;
try {
  const both = name === "URL" ? [URL.canParse("x:y"), constructors[0].canParse("x:y")] : [AbortSignal.abort(), constructors[1].abort()];
  answer = both.map(String).join(" ");
} catch (error) {
  answer = error.constructor.name;
}
console.log("ANSWER", how, "|", answer);
process.exit(0);
`;

// A Worker has a global object of its own, with constructors of its own.
const worker = `
globalThis.held = Bun.pathToFileURL("/a");
let how = "written";
try {
  (0, eval)(["held.constructor.canParse", '= () => "mine"'].join(" "));
} catch (error) {
  how = error.constructor.name + ": " + String(error.message).split(" because ")[0];
}
console.log("ANSWER", how, "|", String(URL.canParse("x:y")));
`;
const startsAWorker = `
const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
await new Promise(resolve => worker.addEventListener("close", resolve));
`;

const files = {
  "main.mjs": program,
  "hidden.mjs": hidden,
  "followed.mjs": followed,
  "named.mjs": named,
  "worker.mjs": worker,
  "starts-a-worker.mjs": startsAWorker,
};

// An executable that ends without an answer says why on stderr.
const answerIn = ({ stdout, stderr }: { stdout: string; stderr: string }) =>
  /^ANSWER (.*)$/m.exec(stdout)?.[1] ?? `no answer: ${stderr.split("\n")[0]}`;
const answerOf = async (cmd: string[], cwd: string) => answerIn(await slot(() => run(cmd, cwd, bunEnv)));

/** The answers of every case, under the words that name it. */
async function answers(answer: (words: string[]) => Promise<string>) {
  const all = await Promise.all(
    cases.map(async ({ member, way, write, words }) => [`${member}, ${way}, ${write}`, await answer(words)]),
  );
  return Object.fromEntries(all);
}

async function compiled(directory: string, file: string, ...more: string[]) {
  const executable = join(directory, file + (isWindows ? ".exe" : ".out"));
  const build = [bunExe(), "build", "--compile", "--aot", `./${file}.mjs`, ...more, "--outfile", executable];
  expect(await slot(() => run(build, directory, bunEnv))).toMatchObject({ exitCode: 0 });
  return executable;
}

let folder: ReturnType<typeof tempDir> | undefined;
let directory: string;
let main: string;
beforeAll(async () => {
  folder = tempDir("constructor-by-every-way", files);
  directory = String(folder);
  main = await compiled(directory, "main");
});
afterAll(() => folder?.[Symbol.dispose]());

test.concurrent("in plain Bun every way writes", async () => {
  const found = await answers(words => answerOf([bunExe(), "run", "./main.mjs", ...words], directory));
  expect(found).toEqual(
    Object.fromEntries(
      cases.map(({ member, way, write }) => [
        `${member}, ${way}, ${write}`,
        write === "a deletion" ? "written | TypeError" : "written | mine",
      ]),
    ),
  );
  expect(await answerOf([bunExe(), "run", "./hidden.mjs"], directory)).toBe("written | mine");
});

test.concurrent("in an executable every way is refused", async () => {
  const found = await answers(words => answerOf([main, ...words], directory));
  expect(found).toEqual(
    Object.fromEntries(cases.map(({ member, way, write }) => [`${member}, ${way}, ${write}`, refusal(member, write)])),
  );
});

// The engine makes these classes itself, and a program takes this prototype from an instance: nothing reports either where it is made.
eachRow([
  gap("the store is made, and the executable ends with 'is not in this realm'", [
    "Temporal.Instant.compare",
    "an instant",
    "held.constructor",
    "-1",
  ]),
  gap("the store is made, and the executable ends with 'is not in this realm'", [
    "WebAssembly.Module.exports",
    "a module of WebAssembly",
    "held.constructor",
    "0",
  ]),
  gap("the store is made", [
    "AbortSignal.prototype.throwIfAborted",
    "a signal",
    "Object.getPrototypeOf(held)",
    "undefined",
  ]),
])(
  "in an executable a store to %s is refused where the program made %s and wrote to %s",
  async (member, made, object, answer) => {
    expect(await answerOf([main, made, object, "a store", member], directory)).toBe(refusal(member, "a store", answer));
  },
);

test.concurrent("in an executable a store through a receiver that the build cannot follow is refused", async () => {
  const executable = await compiled(directory, "hidden");
  expect(await answerOf([executable], directory)).toBe("TypeError: Cannot assign to URL.canParse | true");
});

test.concurrent("in an executable a Worker refuses as the main thread does", async () => {
  const executable = await compiled(directory, "starts-a-worker", "./worker.mjs");
  expect(await answerOf([executable], directory)).toBe("TypeError: Cannot assign to URL.canParse | true");
});

test.concurrent("in an executable a constructor is locked where the program has replaced its name", async () => {
  const executable = await compiled(directory, "named");
  const rows = ["the name written first", "the constructor made first"].flatMap(order => [
    [order, "URL", `held.constructor.canParse = () => "mine"`],
    [order, "URL", `delete held.constructor.canParse`],
    [order, "AbortSignal", `held.constructor.abort = () => "mine"`],
  ]);
  const found = await Promise.all(rows.map(row => answerOf([executable, ...row], directory)));
  expect(found).toEqual(
    rows.map(([, name, text]) =>
      name === "URL"
        ? `TypeError: Cannot ${text.startsWith("delete") ? "delete" : "assign to"} URL.canParse | other true`
        : "TypeError: Cannot assign to AbortSignal.abort | other [object AbortSignal]",
    ),
  );
});

test.concurrent("a store that the build follows is made, in plain Bun and in an executable", async () => {
  const executable = await compiled(directory, "followed");
  expect({
    plain: await answerOf([bunExe(), "run", "./followed.mjs"], directory),
    executable: await answerOf([executable], directory),
  }).toEqual({ plain: "written | mine", executable: "written | mine" });
});

// A test file is compiled too. The instance is made in the test, and the text of the store is joined when the test runs.
const caseOfATestRun = (made: string, object: string, key: string, call: string) => (name: string) => `
import { test } from "bun:test";
${sayOf(name)}
test("${name}", () => {
  globalThis.held = ${made};
  let how = "written";
  try {
    (0, eval)(["${object}.${key}", '= () => "mine"'].join(" "));
  } catch (error) {
    how = error.constructor.name + ": " + String(error.message).split(" because ")[0];
  }
  say(how, "|", String(${call}));
});
`;
// A Bun without optimization builds the layers of a test run for minutes.
if (isDebug)
  console.error(
    "SKIPPED: a-constructor-is-locked-whichever-way-a-program-comes-to-it.test.ts: the test run over two layers, which a debug build of Bun compiles too slowly",
  );
for (const [form, words, skipped] of [
  ["as one program", "TestRunLayers:0", false],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1", isDebug],
] as const) {
  // Each form builds in a folder of its own.
  const project = casesOfOneRun(`constructor-by-every-way-${form.replaceAll(" ", "-")}`);
  const ids = {
    "URL.canParse": project.add(
      caseOfATestRun(`Bun.pathToFileURL("/a")`, "held.constructor", "canParse", `URL.canParse("x:y")`),
    ),
    "AbortSignal.abort": project.add(
      caseOfATestRun(`new AbortController().signal`, "held.constructor", "abort", `AbortSignal.abort()`),
    ),
  };
  test.concurrent.skipIf(skipped)(`in a test run ${form} the constructor of an instance is locked`, async () => {
    const ran = await project.ran(["--aot"], words);
    expect(Object.fromEntries(Object.entries(ids).map(([member, id]) => [member, ran.get(id)]))).toEqual({
      "URL.canParse": { result: "pass", printed: "TypeError: Cannot assign to URL.canParse | true\n" },
      "AbortSignal.abort": {
        result: "pass",
        printed: "TypeError: Cannot assign to AbortSignal.abort | [object AbortSignal]\n",
      },
    });
  });
}

// The host reports a constructor under the class name of the constructor, and the engine looks for a global of that name.
test("the constructor of a class that the global object names has that name for its class", () => {
  const table = readFileSync(join(import.meta.dir, "../../src/jsc/bindings/ZigGlobalObject.lut.txt"), "utf8");
  const names = Array.from(table.matchAll(/^\s+(\w+)\s+\w+ConstructorCallback\s/gm), match => match[1]);
  expect(names.length).toBeGreaterThan(40);
  const classNameOf = (name: string) =>
    /\(Structure [^:]+:\[[^,]+, ([^,]+),/.exec(jscDescribe((globalThis as Record<string, unknown>)[name]))?.[1];
  expect(Object.fromEntries(names.map(name => [name, classNameOf(name)]))).toEqual(
    Object.fromEntries(names.map(name => [name, name])),
  );
});
