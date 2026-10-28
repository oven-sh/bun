// Programs that are more than their code: files that are no code, imports that say how a file is to be read, build options that say it for an extension, and plugins that resolve and load.
// A program that needs nothing of the build prints as an executable what `bun main.ts` prints. One that needs a plugin, a loader of the build or a definition is built twice by one build script,
// with and without `aot`, and both executables print the same. Those leave out what an executable without `aot` answers in its own way: the names of a module that is a text, a list or CommonJS.
//
//   bun builds-with-plugins-loaders-and-import-attributes.ts --bun <bun> --work <folder> --out <folder> [--seconds 300] [--jobs 8] [--seed 1] [--print <seed>]
//
//   a file        JSON, JSON with comments, TOML, YAML, text, bytes, TypeScript, JavaScript, CommonJS; under the extension that is usual for it or under one that says nothing
//   how it is read by its extension, by `with { type: .. }`, by `loader: { ".ext": .. }` of the build, by `--loader .ext:..` of the command line, or by what a plugin answers
//   who asks      `import x from`, `import { a } from`, `import * as`, `export .. from` through a module in between, `await import()`, with and without attributes, `require()`;
//                 code that is read as a text
//   carried       a file that nothing says how to read, and code `with { type: "file" }`: the executable carries it, and what asks for it gets the place where it lies
//   a plugin      JavaScript for a TypeScript file; onLoad by extension: the text of the file changed, another text, an object; as ts, js, json, text, toml, yaml; at once or later
//                 onResolve: to another file, to a module that is in no file, to a namespace; two plugins for one file, of which the first answers nothing
//   the build     define, minify, sourcemap, a banner, a condition of a package's exports, a macro that runs in the build
//   the types     a declaration file says what the odd extensions give, or `// @ts-ignore` stands above the import
//
// Only main prints, one line an import. What names a place in the executable prints as the text of the file that lies there.
//
// A finding: a command that ends by a signal or runs out of its clock, a build that is refused with `aot` alone, an executable that prints something else. One folder a finding in --out, at most three of one kind and first difference.
import { spawn } from "bun";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Random } from "./random";

const argument = (name: string, otherwise?: string) => {
  const at = process.argv.indexOf("--" + name);
  if (at > 0) return process.argv[at + 1];
  if (otherwise === undefined) throw new Error(`--${name} is missing`);
  return otherwise;
};

const show = `function show(value: unknown, depth = 0): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 3) return "..";
  if (value instanceof Uint8Array) return "bytes " + Array.from(value).join(" ");
  if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join(", ") + "]";
  return "{" + Object.keys(value).sort().map(key => key + ": " + show((value as Record<string, unknown>)[key], depth + 1)).join(", ") + "}";
}
async function shown(name: string, get: () => unknown): Promise<void> {
  try {
    console.log(name, show(await get()));
  } catch (error) {
    console.log(name, "throws", error instanceof Error ? error.constructor.name : typeof error);
  }
}`;

/** What a file holds: its text, the loader that fits it, the extension usual for it, and the type of its default export. */
type Content = { loader: string; extension: string; text: (n: number) => string; type: string; names?: string[] };
const contents: Content[] = [
  { loader: "json", extension: "json", text: n => `{ "id": ${n}, "name": "j${n}", "list": [1, 2.5, "x", null], "inner": { "on": true } }\n`, type: "{ id: number; name: string; list: (number | string | null)[]; inner: { on: boolean } }", names: ["id", "name"] },
  { loader: "json", extension: "json", text: n => `[${n}, "two", { "three": 3 }]\n`, type: "(number | string | { three: number })[]" },
  { loader: "json", extension: "json", text: n => `"only a text ${n}"\n`, type: "string" },
  { loader: "jsonc", extension: "jsonc", text: n => `// a comment\n{ "id": ${n}, /* another */ "name": "c${n}", }\n`, type: "{ id: number; name: string }", names: ["id", "name"] },
  { loader: "toml", extension: "toml", text: n => `id = ${n}\nname = "t${n}"\n[inner]\non = true\nlist = [1, 2, 3]\n`, type: "{ id: number; name: string; inner: { on: boolean; list: number[] } }", names: ["id", "name"] },
  { loader: "yaml", extension: "yaml", text: n => `id: ${n}\nname: y${n}\ninner:\n  on: true\n  list:\n    - 1\n    - two\n`, type: "{ id: number; name: string; inner: { on: boolean; list: (number | string)[] } }", names: ["id", "name"] },
  { loader: "text", extension: "txt", text: n => `line one ${n}\nline two é一\n`, type: "string" },
  { loader: "text", extension: "txt", text: () => "", type: "string" },
  { loader: "text", extension: "txt", text: n => `export default ${n}; // looks like code\n`, type: "string" },
  { loader: "file", extension: "bin", text: n => `bytes ${n}\u0001\u0002`, type: "string" },
];

const odd = ["xyz", "data", "tmpl", "conf", "v2", "JSON", "text"];

export function program(seed: number): { files: Record<string, string>; notes: string; byCommandLine: string[] | undefined; runsInPlace: boolean } {
  const random = new Random(seed);
  const files: Record<string, string> = {};
  const notes: string[] = [];
  const imports: string[] = [];
  const lines: string[] = [];
  const declared: string[] = [];
  const loaders: Record<string, string> = {};
  const plugins: string[] = [];
  const declares = random.chance(0.7);
  let onlyAsABundle = false;
  const needsTheBuild = random.chance(0.55);
  // The command line takes loaders and definitions and no plugin written in JavaScript.
  const commandLine = needsTheBuild && random.chance(0.3);
  const count = random.between(1, 5);
  const ignore = "// @ts-ignore\n";

  for (let index = 0; index < count; index++) {
    const kind = random.weighted([[6, "data"], [needsTheBuild && !commandLine ? 4 : 0, "loaded by a plugin"], [needsTheBuild && !commandLine ? 3 : 0, "resolved by a plugin"], [needsTheBuild && !commandLine ? 2 : 0, "TypeScript that a plugin answers as JavaScript"], [needsTheBuild ? 2 : 0, "a file that nothing says how to read"], [2, "code"], [1, "macro"], [1, "package"]]); // prettier-ignore
    const name = `v${index}`;
    const asked = (path: string, attribute: string | undefined, type: string, names: string[] | undefined, needsIgnore: boolean) => {
      const clause = attribute ? ` with { type: "${attribute}" }` : "";
      const head = needsIgnore ? ignore : "";
      let way = random.pick(["default", "default", "namespace", "names", "through", "import()", "import()", "require"]);
      if (!names && (way === "names" || (needsTheBuild && (way === "namespace" || way === "import()")))) way = "default";
      // What require() gives for a text goes by who runs it.
      if (type === "string" && way === "require") way = "default";
      // An attribute stands at an import.
      if (attribute && (way === "through" || way === "require")) way = "default";
      notes.push(`${index}: ${way}${attribute ? " with " + attribute : ""}`);
      if (way === "default") imports.push(`${head}import ${name} from "${path}"${clause};`), lines.push(`await shown("${index}", () => ${name});`);
      else if (way === "namespace") imports.push(`${head}import * as ${name} from "${path}"${clause};`), lines.push(`await shown("${index}", () => ({ ...${name} }));`);
      else if (way === "names" && names) imports.push(`${head}import { ${names.map(each => `${each} as ${name}${each}`).join(", ")} } from "${path}"${clause};`), lines.push(`await shown("${index}", () => [${names.map(each => name + each).join(", ")}]);`);
      else if (way === "through") {
        files[`between${index}.ts`] = `${head}export { default as ${name} } from "${path}"${clause};\n`;
        imports.push(`import { ${name} } from "./between${index}";`), lines.push(`await shown("${index}", () => ${name});`);
      } else if (way === "require" && !attribute) lines.push(`await shown("${index}", () => require("${path}"));`);
      else lines.push(`${head}await shown("${index}", async () => ({ ...(await import("${path}"${attribute ? `, { with: { type: "${attribute}" } }` : ""})) }));`);
    };
    /** What names a place in the executable is read there. */
    const readThere = () => {
      const last = lines.pop()!;
      lines.push(last.replace(/\(\) => (v\d+)\)/, "() => Bun.file($1 as unknown as string).text())"));
    };

    if (kind === "data") {
      const content = random.pick(contents);
      const how = random.pick(["extension", "extension", "attribute", "attribute", needsTheBuild ? "option" : "attribute", needsTheBuild ? "option" : "extension", "attribute on the usual extension", "another attribute"]);
      const extension = how === "extension" || how === "attribute on the usual extension" || how === "another attribute" ? content.extension : random.pick(odd);
      const file = `file${index}.${extension}`;
      files[file] = content.text(index + 1);
      let loader = content.loader;
      // A file that is read in another way than fits its name: as text or as a file, which take anything.
      if (how === "another attribute") loader = random.pick(["text", "file"]);
      const attribute = how.includes("attribute") ? loader : undefined;
      if (how === "option") {
        if (loaders["." + extension] && loaders["." + extension] !== loader) continue;
        loaders["." + extension] = loader;
      }
      const known = ["json", "jsonc", "toml", "yaml", "txt"].includes(extension) && !attribute;
      if (declares && !known) declared.push(`declare module "*/${file}" { const value: ${loader === content.loader ? content.type : "string"}; export default value;${loader === content.loader && content.names ? content.names.map(each => ` export const ${each}: ${each === "id" ? "number" : "string"};`).join("") : ""} }`);
      notes.push(`${index}: ${content.loader} as ${file}, ${how}`);
      if (loader === "file") {
        imports.push(`${declares ? "" : ignore}import ${name} from "./${file}"${attribute ? ` with { type: "file" }` : ""};`);
        lines.push(`await shown("${index}", () => ${name});`);
        readThere();
      } else asked(`./${file}`, attribute, loader === content.loader ? content.type : "string", loader === content.loader ? content.names : undefined, !declares && !known);
    } else if (kind === "loaded by a plugin") {
      const extension = random.pick(odd) + index;
      const file = `file${index}.${extension}`;
      files[file] = `on the disk ${index}\n`;
      const later = random.chance(0.4);
      const [answer, type, names] = random.pick<[string, string, string[] | undefined]>([
        [`{ contents: "export default " + JSON.stringify(text.trim().toUpperCase()) + "; export const id: number = ${index};", loader: "ts" }`, "string", ["id"]],
        [`{ contents: "export default " + JSON.stringify(text.length) + "; export const id = ${index};", loader: "js" }`, "number", ["id"]],
        [`{ contents: "module.exports = { id: ${index}, name: " + JSON.stringify(text.trim()) + " };", loader: "js" }`, "{ id: number; name: string }", undefined],
        [`{ contents: JSON.stringify({ id: ${index}, name: text.trim() }), loader: "json" }`, "{ id: number; name: string }", ["id", "name"]],
        [`{ contents: text + "and more", loader: "text" }`, "string", undefined],
        [`{ contents: "id = ${index}\\nname = \\"p\\"\\n", loader: "toml" }`, "{ id: number; name: string }", ["id", "name"]],
        [`{ contents: "id: ${index}\\nname: p\\n", loader: "yaml" }`, "{ id: number; name: string }", ["id", "name"]],
        [`{ exports: { default: text.trim(), id: ${index}, name: "o" }, loader: "object" }`, "string", ["id", "name"]],
        [`{ contents: "interface Shape { id: number }\\nconst shape: Shape = { id: ${index} };\\nexport default shape;\\nexport const id = shape.id;", loader: "ts" }`, "{ id: number }", ["id"]],
      ]);
      if (random.chance(0.25)) plugins.push(`{ name: "silent${index}", setup(build: any) { build.onLoad({ filter: /\\.${extension}$/ }, () => undefined); } }`);
      plugins.push(`{ name: "load${index}", setup(build: any) { build.onLoad({ filter: /\\.${extension}$/ }, ${later ? "async " : ""}(args: any) => { const text = ${later ? "await Bun.file(args.path).text()" : `require("fs").readFileSync(args.path, "utf8")`}; return ${answer}; }); } }`);
      if (declares) declared.push(`declare module "*/${file}" { const value: ${type}; export default value;${(names ?? []).map(each => ` export const ${each}: ${each === "id" ? "number" : "string"};`).join("")} }`);
      notes.push(`${index}: a plugin loads .${extension}: ${answer.slice(-18)}`);
      asked(`./${file}`, undefined, type, names, !declares);
    } else if (kind === "TypeScript that a plugin answers as JavaScript") {
      const extension = random.pick(["ts", "tsx"]);
      files[`typed${index}.${extension}`] = `export interface Shape { id: number }\nexport const id: number = ${index};\nexport default function typed${index}(shape: Shape): number {\n  return shape.id + id;\n}\n`;
      plugins.push(`{ name: "plain${index}", setup(build: any) { build.onLoad({ filter: /typed${index}\\.${extension}$/ }, () => ({ contents: "export const id = ${index + 100}; export default function typed${index}(shape) { return shape.id + id; }", loader: "${random.pick(["js", "jsx"])}" })); } }`);
      imports.push(`import typed${index}, { id as typedId${index} } from "./typed${index}${random.chance(0.5) ? "" : "." + extension}";`);
      lines.push(`await shown("${index}", () => [typed${index}({ id: 1 }), typedId${index}]);`);
      notes.push(`${index}: a plugin answers JavaScript for .${extension}`);
    } else if (kind === "a file that nothing says how to read") {
      // In an executable it is carried along, and what asks for it gets the place where it lies.
      const extension = random.pick(["so", "dat", "wasmx", "node2"]);
      files[`carried${index}.${extension}`] = `carried ${index}`;
      onlyAsABundle = true;
      if (random.chance(0.5)) lines.push(`await shown("${index}", () => Bun.file(require("./carried${index}.${extension}")).text());`);
      else imports.push(`${ignore}import carried${index} from "./carried${index}.${extension}";`), lines.push(`await shown("${index}", () => Bun.file(carried${index}).text());`);
      notes.push(`${index}: .${extension}, which nothing says how to read`);
    } else if (kind === "resolved by a plugin") {
      const how = random.pick(["another file", "no file", "no file", "a bare name"]);
      notes.push(`${index}: a plugin resolves to ${how}`);
      if (how === "another file") {
        files[`first${index}.ts`] = `export default "first ${index}";\nexport const id: number = 1;\n`;
        files[`second${index}.ts`] = `export default "second ${index}";\nexport const id: number = 2;\n`;
        plugins.push(`{ name: "resolve${index}", setup(build: any) { build.onResolve({ filter: /^\\.\\/first${index}$/ }, () => ({ path: require("path").join(import.meta.dir, "second${index}.ts") })); } }`);
        asked(`./first${index}`, undefined, "string", ["id"], false);
      } else {
        const asks = how === "no file" ? `virtual:thing${index}` : `thing-${index}`;
        plugins.push(
          `{ name: "resolve${index}", setup(build: any) { build.onResolve({ filter: /^${asks}$/ }, (args: any) => ({ path: args.path, namespace: "made${index}" })); build.onLoad({ filter: /.*/, namespace: "made${index}" }, () => (${random.pick([
            `{ contents: "export default 'made ${index}'; export const id: number = ${index}; export function twice(n: number): number { return n * 2; }", loader: "ts" }`,
            `{ contents: "export default 'made ${index}'; export const id = ${index};", loader: "js" }`,
            `{ contents: '{ "id": ${index}, "name": "made" }', loader: "json" }`,
          ])})); } }`,
        );
        if (declares) declared.push(`declare module "${asks}" { const value: unknown; export default value; export const id: number; }`);
        asked(asks, undefined, "unknown", ["id"], !declares);
      }
    } else if (kind === "code") {
      const [extension, text] = random.pick([
        ["ts", `export default class Thing${index} { constructor(public id: number = ${index}) {} }\nexport const id: number = new Thing${index}().id;\n`],
        ["js", `export default function thing${index}() { return ${index}; }\nexport const id = thing${index}();\n`],
        ["cjs", `exports.id = ${index};\nexports.name = "c";\n`],
        ["mjs", `export default [${index}];\nexport const id = ${index};\n`],
        ["tsx", `const wrap = <T,>(value: T): T[] => [value];\nexport default wrap(${index});\nexport const id: number = ${index};\n`],
      ]);
      files[`code${index}.${extension}`] = text;
      notes.push(`${index}: code .${extension}`);
      if (needsTheBuild && random.chance(0.2)) {
        // Code that is carried along as a file and never run.
        onlyAsABundle = true;
        imports.push(`${ignore}import place${index} from "./code${index}.${extension}" with { type: "file" };`);
        lines.push(`await shown("${index}", () => Bun.file(place${index}).text());`);
        continue;
      }
      // Code that is read as a text and never run.
      if (random.chance(0.25)) {
        asked(`./code${index}.${extension}`, "text", "string", undefined, true);
        continue;
      }
      asked(`./code${index}.${extension}`, undefined, "unknown", extension === "cjs" && needsTheBuild ? undefined : ["id"], extension !== "ts" && extension !== "tsx");
    } else if (kind === "macro") {
      files[`macro${index}.ts`] = `export function made(n: number) {\n  return { id: n * 2, name: "in the build", list: [n, n + 1] };\n}\n`;
      imports.push(`import { made as made${index} } from "./macro${index}.ts" with { type: "macro" };`);
      lines.push(`await shown("${index}", () => made${index}(${index + 3}));`);
      notes.push(`${index}: a macro`);
    } else {
      const base = `node_modules/pack${index}`;
      files[`${base}/package.json`] = JSON.stringify({ name: `pack${index}`, version: "1.0.0", exports: { ".": { special: "./special.js", import: "./import.mjs", require: "./require.cjs", default: "./import.mjs" }, "./data": "./data.json" } });
      files[`${base}/special.js`] = `export default "special";\nexport const id = 1;\n`;
      files[`${base}/import.mjs`] = `export default "import";\nexport const id = 2;\n`;
      files[`${base}/require.cjs`] = `module.exports = { default: "require", id: 3 };\n`;
      files[`${base}/data.json`] = `{ "id": 4, "name": "of the package" }\n`;
      notes.push(`${index}: a package`);
      asked(random.chance(0.3) ? `pack${index}/data` : `pack${index}`, undefined, "unknown", ["id"], true);
    }
  }

  const defines: Record<string, string> = {};
  if (needsTheBuild && random.chance(0.5)) {
    defines.BUILT_FLAG = random.pick(["true", "false"]);
    defines.BUILT_NAME = JSON.stringify("n" + random.below(9));
    declared.push("declare const BUILT_FLAG: boolean;", "declare const BUILT_NAME: string;");
    lines.push(`await shown("defined", () => [BUILT_FLAG ? "on" : "off", BUILT_NAME, typeof BUILT_FLAG]);`);
    if (!declares) for (const at of [lines.length - 1]) lines[at] = ignore + lines[at];
  }
  const options: string[] = [];
  if (Object.keys(loaders).length) options.push(`loader: ${JSON.stringify(loaders)}`);
  if (Object.keys(defines).length) options.push(`define: ${JSON.stringify(defines)}`);
  if (random.chance(0.2)) options.push(`minify: ${random.pick(["true", "{ whitespace: true }", "{ syntax: true, identifiers: true }"])}`);
  if (random.chance(0.15)) options.push(`sourcemap: "${random.pick(["none", "inline", "linked"])}"`);
  if (random.chance(0.1)) options.push(`banner: "/* a banner */"`);
  const special = needsTheBuild && random.chance(0.3);
  if (special) options.push(`conditions: ["special"]`);
  if (plugins.length) options.push(`plugins: [${plugins.join(", ")}]`);

  files["main.ts"] = `${imports.join("\n")}\n${show}\n${lines.join("\n")}\nexport {};\n`;
  // `declare const` of a definition is needed either way; the modules only where the program declares them.
  files["declarations.d.ts"] = declared.filter(line => declares || line.startsWith("declare const")).join("\n") + "\n";
  files["tsconfig.json"] = JSON.stringify({ compilerOptions: { strict: true, target: "esnext", module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, allowJs: true, jsx: "react-jsx", noEmit: true }, include: ["main.ts", "declarations.d.ts"] });
  files["build.ts"] = `const result = await Bun.build({ entrypoints: ["./main.ts"], compile: { outfile: process.argv[2], aot: process.argv[3] === "aot" }, ${options.join(", ")}${options.length ? ", " : ""}throw: false });
for (const log of result.logs) console.log(String(log));
process.exit(result.success ? 0 : 1);
`;
  const byCommandLine = commandLine ? [...Object.entries(loaders).map(([extension, loader]) => `--loader=${extension}:${loader}`), ...Object.entries(defines).map(([key, value]) => `--define=${key}=${value}`), ...(special ? ["--conditions=special"] : [])] : undefined;
  notes.push(commandLine ? "by the command line" : "by Bun.build", declares ? "declared" : "ignored", options.filter(option => !option.startsWith("plugins")).join(", "));
  return { files, notes: notes.join("\n"), byCommandLine, runsInPlace: !onlyAsABundle && !plugins.length && !Object.keys(loaders).length && !Object.keys(defines).length && !special };
}

if (import.meta.main) {
  if (process.argv.includes("--print")) {
    const drawn = program(Number(argument("print")));
    for (const [file, text] of Object.entries(drawn.files)) console.log(`==== ${file}\n${text}`);
    console.log(`==== notes\n${drawn.notes}\n${drawn.byCommandLine?.join(" ") ?? ""}`);
    process.exit(0);
  }
  const bun = argument("bun");
  const work = argument("work");
  const out = argument("out");
  const until = Date.now() + Number(argument("seconds", "300")) * 1000;
  const firstSeed = Number(argument("seed", "1"));

  const run = async (command: string[], cwd: string, seconds: number) => {
    const limited = ["/bin/sh", "-c", `prlimit --pid $$ --core=1:1 2> /dev/null || ulimit -c 0; exec "$@"`, "--", ...command];
    const child = spawn(limited, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
    let late = false;
    const timer = setTimeout(() => ((late = true), child.kill(9)), seconds * 1000);
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    return { text: stdout + stderr, out: stdout, code, signal: late ? null : child.signalCode, late };
  };

  const counts = new Map<string, number>();
  const count = (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1);
  let findings = 0;
  const shapeOf = (text: string) => text.replace(/\d+/g, "N").replace(/[^\w{}:.]+/g, "-").slice(0, 90);
  function finding(kind: string, folder: string, seed: number, notes: string, said: string, shape = "") {
    findings++;
    const group = `${kind}${shape ? " " + shapeOf(shape) : ""}`.replace(/[^\w{}:.-]+/g, "-");
    count(`FINDING ${group}`);
    if (readdirSync(out).filter(name => name.startsWith(group + "-seed-")).length >= 3) return;
    const target = join(out, `${group}-seed-${seed}`);
    for (const app of ["app-bundle", "app-aot"]) rmSync(join(folder, app), { force: true });
    cpSync(folder, target, { recursive: true });
    writeFileSync(join(target, "finding.txt"), `${kind}\nseed ${seed}\n${notes}\n\n${said.slice(0, 6000)}\n`);
  }

  async function one(seed: number, job: number) {
    const folder = join(work, "job-" + job);
    rmSync(folder, { recursive: true, force: true });
    const { files, notes, byCommandLine, runsInPlace } = program(seed);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(folder, file)), { recursive: true });
      writeFileSync(join(folder, file), text);
    }
    const built = (how: "bundle" | "aot") =>
      run(byCommandLine ? [bun, "build", "--compile", ...(how === "aot" ? ["--aot", "--aot-threads=1"] : []), ...byCommandLine, "./main.ts", "--outfile", "app-" + how] : [bun, "--no-install", "build.ts", "app-" + how, how], folder, 300);
    const bundle = runsInPlace ? undefined : await built("bundle");
    if (!bundle) {
    } else if (bundle.signal) return finding("the build without aot ends by a signal", folder, seed, notes, bundle.text, String(bundle.signal));
    else if (bundle.late) return finding("the build without aot hangs", folder, seed, notes, bundle.text);
    else if (bundle.code !== 0 || !existsSync(join(folder, "app-bundle"))) return void count(`refused without aot too: ${shapeOf(/^.*error.*$/im.exec(bundle.text)?.[0] ?? "")}`);
    const plain = await run(bundle ? ["./app-bundle"] : [bun, "--no-install", "main.ts"], folder, 40);
    if (plain.signal || plain.late) return finding(bundle ? "the executable without aot ends badly" : "plain Bun ends badly", folder, seed, notes, plain.text, String(plain.signal));
    const build = await built("aot");
    if (build.late) return finding("the build hangs", folder, seed, notes, build.text);
    if (build.signal || /\bpanic(ked)?\b|ASSERTION FAILED|internal compiler error/.test(build.text)) return finding("the build ends badly", folder, seed, notes, build.text, /^.*(panic|ASSERTION FAILED|internal compiler error).*$/m.exec(build.text)?.[0] ?? String(build.signal));
    if (build.code !== 0 || !existsSync(join(folder, "app-aot"))) return finding("the build is refused", folder, seed, notes, build.text, /^.*error.*$/im.exec(build.text)?.[0] ?? "");
    let compiled = await run(["./app-aot"], folder, 40);
    // A machine under load makes a short run long: what is not through in its time gets five times as long, once.
    if (compiled.late) compiled = await run(["./app-aot"], folder, 200);
    if (compiled.signal) return finding("the executable ends by a signal", folder, seed, notes, `${compiled.signal}\n${compiled.text}`, String(compiled.signal));
    if (compiled.late) return finding("the executable hangs", folder, seed, notes, compiled.text, compiled.out.split("\n").at(-2) ?? "");
    if (compiled.out === plain.out && compiled.code === plain.code) return void count(bundle ? "as the executable without aot" : "as bun main.ts");
    const [expected, got] = [plain.out.split("\n"), compiled.out.split("\n")];
    const at = expected.findIndex((line, index) => line !== got[index]);
    finding(bundle ? "the executable prints something else than without aot" : "the executable prints something else than bun main.ts", folder, seed, notes, `exit codes ${plain.code} ${compiled.code}\nline ${at + 1}\nexpected: ${expected[at]}\nwith aot: ${got[at]}\n\n== expected\n${plain.text}\n== with aot\n${compiled.text}`, `${expected[at] ?? "the end"} | ${got[at] ?? "the end"}`);
  }

  mkdirSync(out, { recursive: true });
  let next = firstSeed;
  await Promise.all(
    Array.from({ length: Number(argument("jobs", "8")) }, async (_, job) => {
      while (Date.now() < until) await one(next++, job);
      rmSync(join(work, "job-" + job), { recursive: true, force: true });
    }),
  );
  console.log(`programs ${next - firstSeed} | findings ${findings}`);
  for (const [what, times] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(times).padStart(6), what);
  process.exit(0);
}
