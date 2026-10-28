// A member of Bun that a program names counts as used, however the program names it and however late the compiler comes to the name.
//
//   bun members-of-bun-however-they-are-named.ts --bun <bun> --work <folder> --out <folder> [--seconds 300] [--jobs 8] [--seed 1] [--print <seed>]
//
// A program names 1 to 8 members of Bun, each in a way of its own (by name, by a pattern, on a constant, a parameter, globalThis.Bun, in
// brackets, by Reflect.get, by a descriptor, through require or import), behind 0 to 40 calls whose callees are found one after the
// other. Around them stand unrelated chains, classes and functions, in an order that the seed draws, so that the compiler comes to the
// names early in one program and late in the next. In half of the programs Bun first goes into hands that nobody follows.
// `bun check --aot --explain=trim` lists the members that count as used. Each member that the program names has to be on that list.
// One program in four is also built and run: it uses a few members whose answers are known, and prints what plain Bun prints.
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { Random } from "./random";

const argument = (name: string, otherwise?: string) => {
  const at = process.argv.indexOf("--" + name);
  if (at > 0) return process.argv[at + 1];
  if (otherwise === undefined) throw new Error(`Missing --${name}`);
  return otherwise;
};

// Members that let in code from outside the executable follow rules of their own.
const leftOut = new Set(["ModuleGraph", "Transpiler", "build", "plugin"]);
const members = (Reflect.ownKeys(Bun) as (string | symbol)[])
  .filter((key): key is string => typeof key === "string" && /^[A-Za-z_$][\w$]*$/.test(key) && !leftOut.has(key))
  .sort();

// What can be asked of a member without a network, a file or a clock.
const uses: Record<string, string> = {
  SQL: `typeof new M("postgres://127.0.0.1:1/x")`,
  Glob: `new M("*.ts").match("a.ts")`,
  CryptoHasher: `new M("sha1").update("a").digest("hex")`,
  SHA1: `M.hash("a", "hex")`,
  SHA256: `M.hash("a", "hex")`,
  MD5: `M.hash("a", "hex")`,
  hash: `String(M.crc32("a"))`,
  gzipSync: `M(new Uint8Array(4)).length > 0`,
  deflateSync: `M(new Uint8Array(4)).length > 0`,
  semver: `M.satisfies("1.2.3", "^1.0.0")`,
  TOML: `JSON.stringify(M.parse("a = 1"))`,
  color: `M("red", "hex")`,
  stringWidth: `M("abc")`,
  escapeHTML: `M("<a>")`,
  inspect: `M({ a: 1 })`,
  deepEquals: `M({ a: 1 }, { a: 1 })`,
  pathToFileURL: `M("/a/b").href`,
  fileURLToPath: `M("file:///a/b")`,
  peek: `M(Promise.resolve(3))`,
  randomUUIDv7: `M().length`,
  Cookie: `new M("a", "b").name`,
  CookieMap: `new M("a=b").get("a")`,
  concatArrayBuffers: `M([new Uint8Array(2), new Uint8Array(3)]).byteLength`,
  indexOfLine: `M(new Uint8Array([97, 10, 98]), 0)`,
};

type Way = { before?: (name: string, n: number) => string; read: (name: string, n: number) => string; isAsync?: true };
const ways: Way[] = [
  { read: name => `Bun.${name}` },
  { read: name => `Bun.${name}` },
  { read: name => `(() => { const { ${name}: taken } = Bun; return taken; })()` },
  { read: name => `(() => { const bun = Bun; return bun.${name}; })()` },
  { before: (_, n) => `const bun${n} = Bun;\n`, read: (name, n) => `bun${n}.${name}` },
  { before: (name, n) => `const read${n} = bun => bun.${name};\n`, read: (_, n) => `read${n}(Bun)` },
  { read: name => `globalThis.Bun.${name}` },
  { read: name => `Bun["${name}"]` },
  { read: name => `Reflect.get(Bun, "${name}")` },
  { read: name => `Reflect.get(Bun, "${name}", Bun)` },
  { before: (_, n) => `const { get: get${n} } = Reflect;\n`, read: (name, n) => `get${n}(Bun, "${name}")` },
  { read: name => `Reflect.get.call(undefined, Bun, "${name}")` },
  { before: (_, n) => `const read${n} = key => Reflect.get(Bun, key);\n`, read: (name, n) => `read${n}("${name}")` },
  { read: name => `Reflect.getOwnPropertyDescriptor(Bun, "${name}")` },
  { read: name => `Object.getOwnPropertyDescriptor(Bun, "${name}")` },
  { read: name => `import.meta.require("bun").${name}` },
  { read: name => `(await import("bun")).${name}`, isAsync: true },
];
// A descriptor holds the member under `value` or `get`.
const valueOf = (read: string) =>
  /getOwnPropertyDescriptor/.test(read)
    ? `(found => ("value" in found ? found.value : found.get.call(Bun)))(${read})`
    : read;

const bunLeaves = `const functionNobodyKnows = globalThis[process.argv[2] ?? "Boolean"];
globalThis[process.argv[3] ?? "nothing"] = functionNobodyKnows(1);
functionNobodyKnows(Bun);
`;

function generate(random: Random) {
  const isRun = random.chance(0.25);
  const names = random.sample(
    isRun ? Object.keys(uses).filter(name => members.includes(name)) : members,
    random.pick([1, 1, 2, 3, 5, 8]),
  );
  const parts: string[] = [];
  const calls: string[] = [];
  names.forEach((name, n) => {
    const way = random.pick(ways);
    const depth = random.pick([0, 0, 1, 3, 6, 9, 14, 22, 40]);
    const read = way.read(name, n);
    const body = isRun ? `(M => ${uses[name]})(${valueOf(read)})` : read;
    let text = `${way.before?.(name, n) ?? ""}const holder${n}_0 = { next: ${way.isAsync ? "async " : ""}() => ${body} };\n`;
    for (let index = 1; index <= depth; index++)
      text += `const holder${n}_${index} = { next: () => holder${n}_${index - 1}.next() };\n`;
    parts.push(text);
    calls.push(
      isRun
        ? `console.log("${name}", String(await holder${n}_${depth}.next()));`
        : `console.log("${name}", typeof (await holder${n}_${depth}.next()));`,
    );
  });
  // Unrelated code, so that the work of the compiler takes another order.
  for (let n = random.pick([0, 0, 2, 6, 20]); n > 0; n--) {
    parts.push(
      random.pick([
        `class Unrelated${n} { constructor() { this.value = ${n}; } twice() { return this.value * 2; } }\nkept.push(new Unrelated${n}().twice());\n`,
        `const chain${n}_0 = { next: () => ${n} };\nconst chain${n}_1 = { next: () => chain${n}_0.next() };\nkept.push(chain${n}_1.next());\n`,
        `function unrelated${n}(value) { return value === 0 ? 0 : unrelated${n}(value - 1) + 1; }\nkept.push(unrelated${n}(${n}));\n`,
        `kept.push([${n}, ${n + 1}].map(value => value * 2).join());\n`,
        `kept.push(Reflect.get({ member${n}: ${n} }, "member${n}"));\n`,
      ]),
    );
  }
  const text = `const kept = [];\n${random.chance(0.5) ? bunLeaves : ""}${random.shuffled(parts).join("")}${random.shuffled(calls).join("\n")}\nconsole.log(kept.length);\n`;
  return { text, names, isRun };
}

if (process.argv.includes("--print")) {
  console.log(generate(new Random(Number(argument("print")))).text);
  process.exit(0);
}

const bun = argument("bun", process.execPath);
const work = argument("work");
const out = argument("out");
const until = Date.now() + Number(argument("seconds", "300")) * 1000;
const environment = { ...process.env, BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", NO_COLOR: "1" };
mkdirSync(join(out, "findings"), { recursive: true });

async function run(argv: string[], cwd: string, seconds: number) {
  const child = Bun.spawn(["timeout", "-k", "2", String(seconds), ...argv], {
    cwd,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { stdout, stderr, exitCode: await child.exited };
}

let seed = Number(argument("seed", "1"));
let programs = 0;
let built = 0;
let findings = 0;

function keep(mine: number, kind: string, text: string, said: string) {
  findings++;
  console.log(`seed ${mine}: ${kind}: ${said.split("\n").slice(0, 3).join(" | ").slice(0, 300)}`);
  if (findings > 40) return;
  const kept = join(out, "findings", `${kind.replace(/[^a-z0-9]+/gi, "-").slice(0, 80)}-${mine}`);
  mkdirSync(kept, { recursive: true });
  writeFileSync(join(kept, "program.mjs"), text);
  writeFileSync(join(kept, "said.txt"), `${kind}\n${said}\n`);
}

async function one(mine: number) {
  const { text, names, isRun } = generate(new Random(mine));
  const folder = join(work, "p" + mine);
  mkdirSync(folder, { recursive: true });
  try {
    writeFileSync(join(folder, "program.mjs"), text);
    programs++;
    const checked = await run([bun, "check", "--aot", "--no-pretty", "--explain=trim", "program.mjs"], folder, 120);
    if (checked.exitCode === 124 || checked.exitCode >= 128)
      return keep(mine, `the check ends with ${checked.exitCode}`, text, checked.stderr.slice(-2000));
    const prefix = "aot: trim: uses Bun ";
    const used = new Set(
      checked.stderr
        .split("\n")
        .filter(line => line.startsWith(prefix))
        .map(line => line.slice(prefix.length)),
    );
    const missed = names.filter(name => !used.has(name));
    if (missed.length) return keep(mine, "a named member does not count as used", text, missed.join(" "));
    if (!isRun) return;
    built++;
    const plain = await run([bun, "run", "program.mjs"], folder, 60);
    const build = await run(
      [bun, "build", "--compile", "--aot", "--aot-threads=1", "program.mjs", "--outfile", "program"],
      folder,
      300,
    );
    if (build.exitCode !== 0)
      return keep(mine, `the build ends with ${build.exitCode}`, text, (build.stdout + build.stderr).slice(-2000));
    const compiled = await run(["./program"], folder, 60);
    if (compiled.stdout !== plain.stdout || compiled.exitCode !== plain.exitCode)
      keep(
        mine,
        "prints something else",
        text,
        `plain exit ${plain.exitCode}, compiled exit ${compiled.exitCode}\n--- plain\n${plain.stdout}--- compiled\n${compiled.stdout}--- stderr of the executable\n${compiled.stderr.slice(0, 1500)}`,
      );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

await Promise.all(
  Array.from({ length: Number(argument("jobs", "8")) }, async () => {
    while (Date.now() < until) await one(seed++);
  }),
);
console.log(`programs ${programs} built ${built} findings ${findings} next seed ${seed}`);
