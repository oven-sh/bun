// Text that is half written: a program of ../programs cut off at any character, with a stray token in it, with a part of it gone, there twice or moved, a bracket turned into another, or something nested very deeply.
// `bun check` and `bun build --compile --aot` say what is wrong with it, or nothing, and end by themselves: exit code 0 or 1, within the time limit, without a report of an internal error.
//
//   bun test/aot/fuzz/damaged-text.ts --seconds 600 --jobs 16 --out /tmp/damaged [--bun <path>] [--programs-root <folder>] [--seed <n>] [--files 24] [--only check | build]
//
// `bun check` gets a folder of damaged files at once; when it ends otherwise than it may, each file is asked alone. A finding is made small by taking parts of the text away for half a minute.
// <out>/findings/<kind>-<command>-<hash>/ holds damaged.<extension>, small.<extension>, said.txt and finding.json: the program, what was done to it, the seed. Three findings are kept of what says the same words.
import { spawn } from "bun";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { extname, join, relative } from "path";
import { Random } from "./random";

const stray = ["q", "static q", "@", "(", ")", "{", "}", "[", "]", "=>", "export", "declare", "class", "namespace", "module", "<", ">", "`", "${", "'", '"', "/*", "*/", "//", "/", "\\", "#", "#q", "?.", "...", ";", ",", ":", "?", "=", "async", "await", "yield", "enum", "interface", "type", "abstract", "import", "from", "as", "satisfies", "new", "super", "this", "case 1:", "default:", "else", "catch", "finally", "get", "set", "accessor", "using", "in", "of", "is", "asserts", "infer", "keyof", "unique symbol", "extends", "implements", "function", "function*", "return", "break", "continue", "0x", "1e", "1n.", "1_", " ", "\0", "￿", "\ud800", "😀", "<!--", "-->", "#!", "</", "/>"]; // prettier-ignore
const nests: [string, string][] = [["(", ")"], ["[", "]"], ["{", "}"], ["namespace A {", "}"], ["class A { m() {", "} }"], ["function f() {", "}"], ["if (a) ", ""], ["a ? ", " : b"], ["`${", "}`"], ["() => ", ""], ["!", ""], ["- ", ""], ["typeof ", ""], ["await ", ""], ["new ", ""], ["a.", ""], ["x = ", ""], ["[...", "]"], ["{ a: ", " }"], ["import(", ")"], ["a(", ")"], ["<T>", ""], ["A<", ">"], ["type T = [", "]"], ["type T = { a: ", " }"], ["type T = A extends B ? ", " : C"], ["type T = (a: ", ") => void"], ["type T = keyof ", ""], ["<a>", "</a>"], ["a ?? ", ""], ["a + ", ""], ["a, ", ""], ["for (;;) ", ""], ["label: ", ""], ["try {", "} finally {}"], ["switch (a) { case 1: ", "}"], ["enum E { a = ", " }"], ["@a(", ")"], ["async function* f() { yield* ", " }"], ["declare module 'm' {", "}"], ["x as ", ""], ["x satisfies ", ""], ["/", "/"], ["a?.[", "]"]]; // prettier-ignore

function place(random: Random, text: string): number {
  const at = random.below(text.length + 1);
  if (random.chance(0.5)) return at;
  const next = text.slice(at).search(/[\s(){}[\];,.<>]/);
  return next < 0 ? at : at + next;
}

function damage(random: Random, text: string): { text: string; what: string } {
  const at = place(random, text);
  const length = random.pick([1, 1, 2, 5, 20, 100, 1000]);
  const to = place(random, text);
  switch (random.below(10)) {
    case 0:
      return { text: text.slice(0, at), what: `cut off at ${at}` };
    case 1:
      return { text: text.slice(at), what: `begins at ${at}` };
    case 2:
    case 3:
    case 4: {
      const token = random.pick(stray);
      return { text: `${text.slice(0, at)} ${token}${random.chance(0.5) ? " " : ""}${text.slice(at)}`, what: `${JSON.stringify(token)} at ${at}` };
    }
    case 5:
      return { text: text.slice(0, at) + text.slice(at + length), what: `${length} gone at ${at}` };
    case 6:
      return { text: text.slice(0, at + length) + text.slice(at), what: `${length} twice at ${at}` };
    case 7:
      return { text: text.slice(0, to) + text.slice(at, at + length) + text.slice(to), what: `${length} of ${at} also at ${to}` };
    case 8: {
      const brackets = [...text.matchAll(/[(){}[\]<>`'"]/g)];
      if (!brackets.length) return { text: text.slice(0, at), what: `cut off at ${at}` };
      const one = random.pick(brackets).index;
      const other = random.pick(["(", ")", "{", "}", "[", "]", "<", ">", "`", "'", '"', ""]);
      return { text: text.slice(0, one) + other + text.slice(one + 1), what: `${JSON.stringify(other)} for the bracket at ${one}` };
    }
    default: {
      const [open, close] = random.pick(nests);
      const depth = random.pick([20, 200, 2000, 20000, 100000]);
      const closed = random.pick([depth, depth, depth - 1, 0, depth + 1]);
      return { text: `${text.slice(0, at)} ${open.repeat(depth)}${random.pick(["a", "1", "", "{}", "A"])}${close.repeat(closed)} ${text.slice(at)}`, what: `${JSON.stringify(open)} ${depth} deep, closed ${closed} times, at ${at}` };
    }
  }
}

const tsconfig = JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", allowJs: true, checkJs: true, jsx: "preserve", noEmit: true, strict: true, types: [] }, include: ["*"] });

if (import.meta.main) {
  const option = (name: string, otherwise: string) => (process.argv.includes("--" + name) ? process.argv[process.argv.indexOf("--" + name) + 1] : otherwise);
  const out = option("out", "/tmp/damaged-text"), bun = option("bun", process.execPath), root = option("programs-root", join(import.meta.dir, "..", "programs")), only = option("only", ""); // prettier-ignore
  const jobs = Number(option("jobs", "8")), files = Number(option("files", "24")), end = Date.now() + Number(option("seconds", "60")) * 1000; // prettier-ignore
  let seed = Number(option("seed", String(Date.now())));
  const programs = (readdirSync(root, { recursive: true }) as string[]).filter(name => /\.(ts|tsx|js|mts|cts)$/.test(name) && !name.endsWith(".d.ts")).sort().map(name => join(root, name)); // prettier-ignore
  mkdirSync(join(out, "findings"), { recursive: true });

  const commands: Record<string, (file?: string) => string[]> = {
    check: () => [bun, "check"],
    build: file => [bun, "build", "--compile", "--aot", "--aot-threads=1", file!, "--outfile", "executable"],
  };
  /** Nothing when the command ended as it may. */
  const judged = async (command: string[], cwd: string, seconds: number) => {
    const child = spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, BUN_ENABLE_CRASH_REPORTING: "0", NO_COLOR: "1" } });
    let late = false;
    const timer = setTimeout(() => ((late = true), child.kill(9)), seconds * 1000);
    const [said, more, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    const all = said + more;
    // Not the lines of the program that a diagnostic shows. Too little stack for what is nested a hundred thousand deep is said in so many words, which is an answer.
    const inner = /^(?! *\d+ \|)(?!.*ran out of stack).*(panic|internal compiler error|internal error:|unreachable code|ASSERTION|RELEASE_ASSERT|Segmentation fault|Bun has).*/m.exec(all)?.[0];
    const kind = late ? "hang" : child.signalCode || code > 1 ? "crash" : inner ? "internal-error" : "";
    return kind ? { kind, words: late ? `not through in ${seconds} s` : `${child.signalCode ?? "exit " + code} ${inner ?? ""}`, said: all.slice(0, 4000) } : undefined;
  };
  const alone = async (name: string, folder: string, file: string, text: string, seconds: number) => {
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, file), text);
    writeFileSync(join(folder, "tsconfig.json"), tsconfig);
    return judged(commands[name](file), folder, seconds);
  };

  let drawn = 0, stored = 0; // prettier-ignore
  const seen = new Map<string, number>();
  await Promise.all(
    Array.from({ length: jobs }, async (_, job) => {
      const folder = join(out, "work-" + job), single = join(out, "work-" + job + "-alone"); // prettier-ignore
      while (Date.now() < end) {
        rmSync(folder, { recursive: true, force: true });
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "tsconfig.json"), tsconfig);
        const batch = Array.from({ length: files }, (_, index) => {
          const mine = seed++, random = new Random(mine), path = programs[mine % programs.length]; // prettier-ignore
          let { text, what } = damage(random, readFileSync(path, "utf8").slice(0, 30_000));
          if (random.chance(0.2)) ({ text, what } = (second => ({ text: second.text, what: what + "; " + second.what }))(damage(random, text)));
          const file = `d${index}${extname(path)}`;
          writeFileSync(join(folder, file), text);
          return { seed: mine, path, text, what, file };
        });
        drawn += files;
        const suspects: { name: string; each: (typeof batch)[number] }[] = [];
        if (only !== "build" && (await judged(commands.check(), folder, 120))) for (const each of batch) suspects.push({ name: "check", each });
        if (only !== "check") for (const each of batch) if (await judged(commands.build(each.file), folder, 180)) suspects.push({ name: "build", each });
        for (const { name, each } of suspects) {
          const verdict = await alone(name, single, each.file, each.text, 180);
          if (!verdict) continue;
          const signature = `${verdict.kind} ${name} ${verdict.words.replace(/\d+/g, "N").slice(0, 200)}`;
          seen.set(signature, (seen.get(signature) ?? 0) + 1);
          appendFileSync(join(out, "findings.tsv"), [each.seed, name, verdict.kind, verdict.words.slice(0, 200), relative(root, each.path), each.what].join("\t") + "\n");
          if (seen.get(signature)! > 3) continue;
          stored++;
          let small = each.text;
          const until = Date.now() + 30_000;
          for (let size = small.length >> 1; size >= 1 && Date.now() < until; size >>= 1)
            for (let at = 0; at < small.length && Date.now() < until; ) {
              const shorter = small.slice(0, at) + small.slice(at + size);
              if ((await alone(name, single, each.file, shorter, 180))?.kind === verdict.kind) small = shorter;
              else at += size;
            }
          const finding = join(out, "findings", `${name === "build" ? "build-" : ""}${verdict.kind}-${name}-${Bun.hash(signature + seen.get(signature)).toString(16).slice(0, 8)}`);
          mkdirSync(finding, { recursive: true });
          writeFileSync(join(finding, "damaged" + extname(each.file)), each.text);
          writeFileSync(join(finding, "small" + extname(each.file)), small);
          writeFileSync(join(finding, "said.txt"), verdict.said);
          writeFileSync(join(finding, "finding.json"), JSON.stringify({ command: name, kind: verdict.kind, words: verdict.words, program: relative(root, each.path), what: each.what, seed: each.seed }, null, 1));
        }
        writeFileSync(join(out, "status.txt"), `programs ${drawn} distinct stored ${stored}\n`);
      }
    }),
  );
  writeFileSync(join(out, "status.txt"), `programs ${drawn} distinct stored ${stored}\n${[...seen].map(([signature, count]) => `${count}\t${signature}`).join("\n")}\n`);
}
