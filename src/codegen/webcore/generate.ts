// Makes src/jsc/bindings/webcore/generated/ and the CSS property tables from a WebKit checkout. See README.md.
//
//   bun src/codegen/webcore/generate.ts                      everything
//   bun src/codegen/webcore/generate.ts Node HTMLDivElement  only these bindings, and the lists. A new name is added to interfaces.txt.
//   --webcore=<directory>   Source/WebCore of the checkout. Default: $WEBCORE_SOURCE_DIR, then vendor/WebKit/Source/WebCore.
//   --out=<directory>       where to write. Default: src/jsc/bindings/webcore/generated, and the CSS property tables where they are in the tree.
//   --check                 writes nothing, and fails if a file in the output directory is not what would be written.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { headersMadeByTheBuild } from "./bindings-rules.ts";
import { adaptBinding } from "./bindings.ts";
import { makeCSSPropertyTables } from "./css-properties.ts";
import { makeLists } from "./lists.ts";
import { adaptNames } from "./names.ts";
import { Upstream } from "./upstream.ts";
import { type Files, headersUnder } from "./util.ts";

const here = import.meta.dirname;
const repository = path.resolve(here, "../../..");
const bindingsDirectory = path.join(repository, "src/jsc/bindings");
const generatedDirectory = path.join(bindingsDirectory, "webcore/generated");

const { values: options, positionals: requested } = parseArgs({
  allowPositionals: true,
  options: { webcore: { type: "string" }, out: { type: "string" }, check: { type: "boolean" } },
});
const webcore = path.resolve(
  options.webcore ?? process.env.WEBCORE_SOURCE_DIR ?? path.join(repository, "vendor/WebKit/Source/WebCore"),
);
const out = path.resolve(options.out ?? generatedDirectory);
const everything = requested.length === 0;

const interfacesFile = path.join(here, "interfaces.txt");
const interfaces = fs.readFileSync(interfacesFile, "utf8").split("\n").filter(Boolean);
const added = requested.filter(name => !interfaces.includes(name));
interfaces.push(...added);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bun-webcore-codegen-"));
try {
  const upstream = new Upstream(webcore, scratch);
  const files: Files = new Map();

  // Every header that a generated file can include: the ones in the tree, and the ones that are about to be made.
  const knownHeaders = new Set([
    ...headersUnder(bindingsDirectory, generatedDirectory),
    ...headersMadeByTheBuild,
    ...interfaces.map(name => `JS${name}.h`),
  ]);
  const add = (more: Files) => {
    for (const [name, text] of more) {
      files.set(name, text);
      if (name.endsWith(".h")) knownHeaders.add(name);
    }
  };
  // The lists are made last, from the bindings, and the bindings include two of them.
  knownHeaders.add("JSWindowInterfaces.h");

  if (everything) {
    const names = upstream.makeNames();
    adaptNames(names, new Set(interfaces), knownHeaders);
    add(names);
    add(upstream.makeOtherFiles());
  } else {
    for (const name of fs.readdirSync(out)) if (name.endsWith(".h")) knownHeaders.add(name);
  }

  upstream.preprocessIDLFiles(path.join(here, "idl"));
  for (const [name, generated] of await upstream.generateBindings(everything ? interfaces : requested)) {
    const { header, implementation } = adaptBinding(name, generated, knownHeaders);
    files.set(`JS${name}.h`, header);
    files.set(`JS${name}.cpp`, implementation);
  }

  const bindings: Files = new Map(files);
  if (!everything)
    for (const name of fs.readdirSync(out))
      if (/^JS.*\.cpp$/.test(name) && !bindings.has(name))
        bindings.set(name, fs.readFileSync(path.join(out, name), "utf8"));
  add(makeLists(bindings));

  // Where each file goes: path -> text.
  const targets = new Map(Array.from(files, ([name, text]) => [path.join(out, name), text]));
  if (everything)
    for (const [file, text] of makeCSSPropertyTables(webcore, repository))
      targets.set(options.out ? path.join(out, path.basename(file)) : path.join(repository, file), text);

  const changed = [...targets].filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text);
  const inOutputDirectory =
    everything && fs.existsSync(out) ? fs.readdirSync(out).map(name => path.join(out, name)) : [];
  const stale = inOutputDirectory.filter(file => !targets.has(file));
  const shown = (file: string) => path.relative(process.cwd(), file);

  if (options.check) {
    for (const [file] of changed) console.log(fs.existsSync(file) ? "differs:" : "missing:", shown(file));
    for (const file of stale) console.log("not made by the generator:", shown(file));
    console.log(
      `${targets.size} files made, ${changed.length} differ or are missing, ${stale.length} are not made by the generator`,
    );
    process.exitCode = changed.length || stale.length ? 1 : 0;
  } else {
    fs.mkdirSync(out, { recursive: true });
    for (const [file, text] of changed) fs.writeFileSync(file, text);
    for (const file of stale) fs.rmSync(file);
    if (added.length) fs.writeFileSync(interfacesFile, interfaces.join("\n") + "\n");
    console.log(`${targets.size} files made, ${changed.length} written, ${stale.length} removed`);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
