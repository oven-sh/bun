import * as fs from "fs";
import * as Module from "module";
import * as path from "path";
import * as zlib from "zlib";

const allFiles = fs.readdirSync(".").filter(f => f.endsWith(".js"));
const outdir = process.argv[2];
const builtins = new Set(Module.builtinModules);
const polyfills = new Set(allFiles.map(f => f.slice(0, -".js".length)));

// Directory of a repeated copy of a package version -> directory of the first copy, in path order.
const firstCopyOf = new Map<string, string>();
{
  const first = new Map<string, string>();
  const scan = (nodeModules: string) => {
    for (const entry of fs.readdirSync(nodeModules).sort()) {
      const dir = `${nodeModules}/${entry}`;
      const manifest = path.join(dir, "package.json");
      if (!fs.existsSync(manifest)) continue;
      const { name, version } = JSON.parse(fs.readFileSync(manifest, "utf8"));
      const id = `${name}@${version}`;
      if (first.has(id)) {
        firstCopyOf.set(dir, first.get(id)!);
        continue;
      }
      first.set(id, dir);
      if (fs.existsSync(`${dir}/node_modules`)) scan(`${dir}/node_modules`);
    }
  };
  scan(fs.realpathSync("node_modules").replaceAll("\\", "/"));
}

function browserMap(file: string) {
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) return JSON.parse(fs.readFileSync(manifest, "utf8")).browser;
  }
}

const resolveForPolyfill = (polyfill: string): Bun.BunPlugin => ({
  name: "resolve for a node fallback",
  setup(build) {
    // process/browser.js gives streams a setTimeout queue of their own. util-deprecate/browser.js reads localStorage.
    build.onResolve({ filter: /^(process\/|util-deprecate)$/ }, args => {
      const manifest = Bun.resolveSync(`${args.path.replace(/\/$/, "")}/package.json`, path.dirname(args.importer));
      return { path: path.join(path.dirname(manifest), JSON.parse(fs.readFileSync(manifest, "utf8")).main) };
    });
    // Not `external`: the bun that runs codegen inlines its own polyfill before it reads `external`.
    build.onResolve({ filter: /^(node:)?[a-z0-9_]+(\/[a-z0-9_]+)*$/ }, args => {
      const bare = args.path.startsWith("node:") ? args.path.slice("node:".length) : args.path;
      if (!builtins.has(bare) && !builtins.has(`node:${bare}`)) return undefined;
      if (bare === polyfill && browserMap(args.importer)?.[bare] === false) return undefined;
      return { path: args.path, external: true };
    });
    build.onLoad({ filter: /[\\/]node_modules[\\/]/ }, args => {
      const file = args.path.replaceAll("\\", "/");
      for (const [dir, first] of firstCopyOf) {
        if (!file.startsWith(`${dir}/`)) continue;
        return {
          contents: `module.exports = require(${JSON.stringify(first + file.slice(dir.length))});`,
          loader: "js",
        };
      }
    });
  },
});

const requireShim = /var __require=\(\(x\)=>typeof require<"u"\?require:.*?is not supported'\)\}\);/;

const hostProcess = 'globalThis.process?.versions?.node&&typeof globalThis.process.nextTick=="function"';

// Free `process` / `Buffer` in the npm packages: rename, then bind with the line for the output format.
const injectedGlobals = [
  {
    defines: ["process", "global.process"],
    id: "__bun_process",
    // A Node.js-like host keeps its own process. A page, also one with a partial `process` shim, gets the polyfill.
    esm: `import __bun_process_polyfill from "process";var __bun_process=${hostProcess}?globalThis.process:__bun_process_polyfill;`,
    cjs: `var __bun_process=${hostProcess}?globalThis.process:(m=>m.default||m)(require("process"));`,
  },
  {
    defines: ["Buffer"],
    id: "__bun_Buffer",
    esm: 'import { Buffer as __bun_Buffer } from "buffer";',
    cjs: 'var __bun_Buffer = require("buffer").Buffer;',
  },
];

// Node.js globals that a browser does not have and that no polyfill binds. A polyfill that reads one fails the build.
const notInABrowser = ["setImmediate", "clearImmediate", "__dirname", "__filename"];

let commands: Promise<void>[] = [];

for (const name of allFiles) {
  const polyfill = name.slice(0, -".js".length);

  const source = fs.readFileSync(name, "utf8");

  // A source that sets `module.exports` stays CommonJS, so `require()` of the polyfill returns that value.
  const format = /^module\.exports\s*=/m.test(source) ? "cjs" : "esm";

  // An ES module without a default export gets one that has every named export.
  const named = new Bun.Transpiler().scan(source).exports;
  const needsDefault = format === "esm" && !named.includes("default");
  // `export { local as name }` has no binding called `name`, so that default reads `local`.
  const localOf = new Map<string, string>();
  for (const [, clause] of source.matchAll(/^export\s*\{([^}]*)\}(?!\s*from\b)/gm)) {
    for (const item of clause.split(",")) {
      const [local, exported = local] = item.trim().split(/\s+as\s+/);
      if (local) localOf.set(exported, local);
    }
  }
  // A name that another module exports has no binding here at all. The default would read a global.
  if (needsDefault && /^export\s*(\*|\{[^}]*\}\s*from\b)/m.test(source)) {
    throw new Error(`${name} exports names of another module. Write its \`export default\` by hand.`);
  }
  const defaultExport = `export default { ${named.map(exported => {
    const local = localOf.get(exported) ?? exported;
    return local === exported ? exported : `${exported}: ${local}`;
  })} };`;

  commands.push(
    Bun.build({
      entrypoints: [name],
      files: needsDefault ? { [path.resolve(name)]: `${source}\n${defaultExport}` } : {},
      outdir,
      target: "browser",
      format,
      minify: { syntax: true, whitespace: true },
      define: {
        "process.env.NODE_DEBUG": "false",
        "process.browser": "true",
        "global": "globalThis",
        ...Object.fromEntries(injectedGlobals.flatMap(g => g.defines.map(d => [d, g.id]))),
        ...Object.fromEntries(notInABrowser.map(global => [global, `__bun_no_${global}`])),
      },
      plugins: [resolveForPolyfill(polyfill)],
      metafile: true,
      throw: true,
    }).then(async ({ metafile }) => {
      if (!metafile) throw new Error("This bun has no Bun.build({ metafile })");
      const exported = Object.values(metafile.outputs).flatMap(output => output.exports ?? []);
      if (format === "esm" && !exported.includes("default")) throw new Error(`${name} has no default export`);
      const inlined = Object.keys(metafile.inputs).filter(input => input.startsWith("node:"));
      if (inlined.length > 0) {
        throw new Error(`${name} bundles ${inlined.join(", ")} from the bun that runs codegen`);
      }

      // This is very brittle. But that should be okay for our usecase
      let outfile = fs
        .readFileSync(`${outdir}/${name}`, "utf8")
        .replaceAll("__require(", "require(")
        .replace(requireShim, "")
        .trim();

      if (outfile.includes("__require")) {
        throw new Error("Unexpected __require in " + name);
      }

      for (const global of notInABrowser) {
        if (outfile.includes(`__bun_no_${global}`)) throw new Error(`${name} reads the global \`${global}\``);
      }

      for (const { id, esm, cjs } of injectedGlobals) {
        if (!outfile.includes(id)) continue;
        outfile = (format === "cjs" ? cjs : esm) + outfile;
      }

      for (const { path: specifier } of new Bun.Transpiler().scanImports(outfile)) {
        const builtin = specifier.replace(/^node:/, "");
        if (builtin === polyfill) {
          throw new Error(`${name} requires itself`);
        }
        if (!polyfills.has(builtin) && builtin !== "vm" && builtin !== "timers/promises") {
          throw new Error(`Unexpected import of "${specifier}" in ${name}`);
        }
      }

      if (outfile.includes("import.meta")) {
        throw new Error("Unexpected import.meta in " + name);
      }

      if (outfile.includes(".$apply")) {
        throw new Error("$apply is not supported in browsers (while building " + name + ")");
      }

      if (outfile.includes(".$call")) {
        throw new Error("$call is not supported in browsers (while building " + name + ")");
      }

      if (
        outfile.includes("$isObject(") ||
        outfile.includes("$isPromise(") ||
        outfile.includes("$isUndefinedOrNull(") ||
        outfile.includes("$newPromiseCapability(")
      ) {
        throw new Error("Unsupported function in " + name);
      }

      fs.writeFileSync(`${outdir}/${name}`, outfile);
      // Release builds embed the zstd-compressed copy (see
      // src/resolver/node_fallbacks.rs) so the ~1 MB of polyfill text doesn't
      // sit uncompressed in the binary; debug builds keep reading the plain
      // `.js` at runtime.
      fs.writeFileSync(
        `${outdir}/${name}.zst`,
        zlib.zstdCompressSync(Buffer.from(outfile), { params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 } }),
      );
    }),
  );
}

await Promise.all(commands);
