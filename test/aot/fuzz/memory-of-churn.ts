// Containers that are filled and emptied for millions of turns, with a bound on memory. No answer tells of a leak: the judge is the largest resident size of the process.
//
//   bun test/aot/fuzz/memory-of-churn.ts --out /tmp/churn --seconds 600 --jobs 8 [--bun <path>] [--seed <n>] [--flags "--aot-heat=everything-is-hot"]
//
// Each program is drawn from a container, how it is filled, how it is emptied, who holds it and what it holds. It runs for n turns and for four times n, in plain Bun and as an executable.
// What is alive at any time does not grow with the turns. A program is kept in <out>/findings when the executable
//   grows:  takes over 1.7 times the memory for four times the turns (and 48 MB more) while plain Bun stays within 1.3 times, and more again for sixteen times the turns (one late collection is no growth), or
//   is fat: takes over twice the memory of plain Bun and 64 MB more, or
//   prints something else, or ends otherwise.
// <out>/table.tsv has a line for every program: seed, what it is, the four sizes in MB, the two times of the long runs.
import { spawn } from "bun";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { Random } from "./random";

const values = [`turn`, `turn + 0.5`, `"s" + turn`, `{ a: turn, b: "b" }`, `[turn, turn + 1]`, `new Item(turn)`, `() => turn`, `new Uint8Array(64)`, `{ ["k" + (turn % 50)]: turn }`, `new Map([[turn, turn]])`, `"x".repeat(100) + turn`, `BigInt(turn)`, `Symbol()`, `new Error("e" + turn)`, `Promise.resolve(turn)`, `/a/g`, `new Date(turn)`, `item.method.bind(item)`];

// Each fills `size` entries and leaves nothing behind. `H` is where the container is held, `X` what goes in.
const churns: Record<string, string> = {
  "a Map filled and cleared": `for (let i = 0; i < size; i++) H.set(turn * size + i, X); count += H.size; H.clear();`,
  "a Map filled and emptied key by key": `for (let i = 0; i < size; i++) H.set(turn * size + i, X); count += H.size; for (const key of [...H.keys()]) H.delete(key);`,
  "a Map replaced by a new one": `H = new Map(); for (let i = 0; i < size; i++) H.set("k" + i, X); count += H.size;`,
  "a Map with objects as keys": `for (let i = 0; i < size; i++) H.set({ i }, X); count += H.size; H.clear();`,
  "a Map that keeps its size while keys come and go": `H.set(turn, X); if (H.size > size) H.delete(turn - size); count += H.size;`,
  "a Set filled and cleared": `for (let i = 0; i < size; i++) H.add(turn * size + i); H.add(X); count += H.size; H.clear();`,
  "a Set replaced by a new one": `H = new Set(); for (let i = 0; i < size; i++) H.add("k" + i + turn); H.add(X); count += H.size;`,
  "a WeakMap of keys that die": `for (let i = 0; i < size; i++) H.set({ i }, X); count++;`,
  "a WeakSet of members that die": `for (let i = 0; i < size; i++) H.add({ i, x: X }); count++;`,
  "weak references that die": `H = []; for (let i = 0; i < size; i++) H.push(new WeakRef({ i, x: X })); count += H.length;`,
  "a list pushed and popped": `for (let i = 0; i < size; i++) H.push(X); count += H.length; while (H.length) H.pop();`,
  "a list pushed and cut to nothing": `for (let i = 0; i < size; i++) H.push(X); count += H.length; H.length = 0;`,
  "a list as a queue": `H.push(X); if (H.length > size) H.shift(); count += H.length;`,
  "a list replaced by a new one": `H = []; for (let i = 0; i < size; i++) H[i] = X; count += H.length;`,
  "a list spliced in the middle": `for (let i = 0; i < size; i++) H.splice(H.length >> 1, 0, X); count += H.length; H.splice(0, H.length);`,
  "a list copied by spread, map and filter": `H = [...H, X].map((each: unknown) => each).filter((_: unknown, i: number) => i > H.length - size); count += H.length;`,
  "an object as a table, names come and go": `for (let i = 0; i < size; i++) H["n" + (turn * size + i)] = X; count += Object.keys(H).length; for (const name in H) delete H[name];`,
  "an object as a table replaced by a new one": `H = {}; for (let i = 0; i < size; i++) H["n" + i] = X; count += Object.keys(H).length;`,
  "objects of shapes that never come again": `H = {}; H["only" + turn] = X; H.a = turn; count += H.a > -1 ? 1 : 0;`,
  "a string joined and cut": `H = (H + "piece" + turn).slice(-size); count += H.length;`,
  "text parsed and printed": `H = JSON.parse(JSON.stringify({ list: Array.from({ length: size }, (_, i) => ({ i, turn })) })); count += H.list.length;`,
  "closures over closures": `{ const before = H; H = () => X; count += typeof before === "function" ? 1 : 0; }`,
  "a chain that loses its tail": `H = { next: null, x: X, prior: H ? 1 : 0 }; count += H.prior;`,
  "instances that get more fields": `H = new Item(turn); for (let i = 0; i < Math.min(size, 40); i++) H["more" + i] = X; count += H.id > -1 ? 1 : 0;`,
  "generators left half way": `H = (function* () { for (let i = 0; i < size; i++) yield X; })(); H.next(); count++;`,
  "a sort of a fresh list": `H = Array.from({ length: size }, (_, i) => (i * 7919 + turn) % size).sort((a: number, b: number) => a - b); count += H[0] + 1;`,
  "matches of a pattern": `H = ("a" + turn + "b").repeat(Math.min(size, 200)).match(/a(\\d+)b/g); count += H.length;`,
  "buffers made and dropped": `H = new Uint8Array(size * 8); H[0] = turn; count += H.length > 0 ? 1 : 0;`,
  "listeners added and removed": `{ const listen = () => X; target.addEventListener("e", listen); target.removeEventListener("e", listen); count++; }`,
  "timers set and cleared": `for (let i = 0; i < Math.min(size, 20); i++) clearTimeout(setTimeout(() => X, 1000)); count++;`,
  "controllers that abort": `H = new AbortController(); H.signal.addEventListener("abort", () => X); H.abort(); count++;`,
  "objects of the host": `H = [new URL("http://localhost/" + turn), new Headers({ a: "b" + turn }), new TextEncoder().encode("t" + turn), new Blob(["b" + turn])]; count += H.length;`,
};
const starts: [RegExp, string][] = [[/Map with|a Map /, "new Map()"], [/a Set /, "new Set()"], [/WeakMap/, "new WeakMap()"], [/WeakSet/, "new WeakSet()"], [/a list|weak ref/, "[]"], [/an object as|objects of shapes/, "{}"], [/a string/, `""`], [/./, "null"]]; // prettier-ignore

export function generate(random: Random): { text: string; what: string; turns: number } {
  const name = random.pick(Object.keys(churns));
  const value = random.pick(values);
  const size = random.pick([1, 8, 100, 1000, 20000]);
  const holder = random.pick(["local", "module", "field", "captured", "static"] as const);
  const H = { local: "held", module: "held", field: "box.held", captured: "held", static: "Box.held" }[holder];
  const start = starts.find(([pattern]) => pattern.test(name))![1];
  const body = churns[name].replace(/\bH\b/g, H).replace(/\bX\b/g, `(${value})`);
  const isAsync = random.chance(0.25);
  const loop = `for (let turn = 0; turn < turns; turn++) {\n    ${body}${isAsync ? `\n    if (turn % 1000 === 0) await null;` : ""}\n  }`;
  const text = `class Item {\n  id: number;\n  [more: string]: unknown;\n  constructor(id: number) {\n    this.id = id;\n  }\n  method() {\n    return this.id;\n  }\n}
class Box {\n  static held: any = ${start};\n  held: any = ${start};\n}
const item = new Item(0);\nconst target = new EventTarget();\nconst box = new Box();\nconst size = ${size};\nconst turns = Number(process.argv[2]);\n${holder === "module" ? `let held: any = ${start};\n` : ""}
${isAsync ? "async " : ""}function run(): ${isAsync ? "Promise<number>" : "number"} {\n  let count = 0;\n  ${holder === "local" || holder === "captured" ? `let held: any = ${start};\n  ` : ""}${holder === "captured" ? `const look = () => held;\n  ` : ""}${loop}\n  return count${holder === "captured" ? ` + (look() === undefined ? 1 : 0)` : ""};\n}
console.log(${isAsync ? "await " : ""}run());\n`;
  // About as much work whatever the size.
  return { text, what: `${name} | ${value} | size ${size} | ${holder}${isAsync ? " | async" : ""}`, turns: Math.max(200, Math.floor(3_000_000 / size)) };
}

if (import.meta.main) {
  const option = (name: string) => (process.argv.includes("--" + name) ? process.argv[process.argv.indexOf("--" + name) + 1] : undefined);
  const [out, bun, jobs] = [option("out")!, option("bun") ?? process.execPath, Number(option("jobs") ?? 4)];
  const [end, flags] = [Date.now() + Number(option("seconds") ?? 60) * 1000, (option("flags") ?? "").split(" ").filter(Boolean)];
  let seed = Number(option("seed") ?? Date.now());
  mkdirSync(join(out, "findings"), { recursive: true });
  const tsconfig = JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, strict: true, types: [] } });
  const measured = async (cmd: string[], cwd: string) => {
    const began = Date.now();
    const child = spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe", timeout: 300_000, env: { ...process.env, BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1" } });
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    await child.exited;
    return { said: `${stdout}${stderr.slice(0, 2000)}exit ${child.exitCode} ${child.signalCode ?? ""}`, megabytes: Math.round((child.resourceUsage()?.maxRSS ?? 0) / 1024 / 1024), seconds: (Date.now() - began) / 1000 };
  };
  let programs = 0, stored = 0; // prettier-ignore
  await Promise.all(
    Array.from({ length: jobs }, async (_, job) => {
      while (Date.now() < end) {
        const mine = seed++;
        const { text, what, turns } = generate(new Random(mine));
        const folder = join(out, "work-" + job);
        rmSync(folder, { recursive: true, force: true });
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "program.ts"), text);
        writeFileSync(join(folder, "tsconfig.json"), tsconfig);
        const build = await measured([bun, "build", "--compile", "--aot", "--aot-threads=1", ...flags, "program.ts", "--outfile", "executable"], folder);
        const runs = build.said.endsWith("exit 0 ") ? [await measured([bun, "run", "program.ts", String(turns)], folder), await measured([bun, "run", "program.ts", String(turns * 4)], folder), await measured(["./executable", String(turns)], folder), await measured(["./executable", String(turns * 4)], folder)] : []; // prettier-ignore
        const [plain, plainLong, compiled, compiledLong] = runs;
        let verdict = !runs.length ? "no build" : plain.said !== compiled.said || plainLong.said !== compiledLong.said ? "answers differ" : compiledLong.megabytes > compiled.megabytes * 1.7 && compiledLong.megabytes > compiled.megabytes + 48 && plainLong.megabytes < plain.megabytes * 1.3 ? "grows" : compiledLong.megabytes > plainLong.megabytes * 2 + 64 ? "is fat" : "";
        if (verdict === "grows") {
          const longest = await measured(["./executable", String(turns * 16)], folder);
          runs.push(longest);
          if (longest.megabytes < compiledLong.megabytes * 1.3) verdict = "";
        }
        programs++;
        appendFileSync(join(out, "table.tsv"), [mine, what, ...runs.slice(0, 4).map(run => run.megabytes), plainLong?.seconds, compiledLong?.seconds, verdict].join("\t") + "\n");
        if (!verdict) continue;
        stored++;
        const kind = verdict === "answers differ" && /exit (null|13\d) /.test(compiled.said + compiledLong.said) ? "crash" : verdict === "no build" ? "build-error" : "different-output";
        const finding = join(out, "findings", `${kind}-${verdict.replaceAll(" ", "-")}-${mine}`);
        mkdirSync(finding, { recursive: true });
        writeFileSync(join(finding, "original.ts"), text);
        writeFileSync(join(finding, "finding.json"), JSON.stringify({ kind: verdict, what, seed: mine, turns, flags, megabytes: runs.map(run => run.megabytes), build: runs.length ? undefined : build.said, plain: plainLong?.said.slice(0, 500), compiled: compiledLong?.said.slice(0, 500) }, null, 1));
      }
    }),
  );
  writeFileSync(join(out, "status.txt"), `programs ${programs} distinct stored ${stored}\n`);
}
