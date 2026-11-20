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

// Packages of these polyfills read the Buffer global, which a browser does not have. They get the sibling polyfill's.
const readsBufferGlobal = new Set(["crypto"]);

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

let commands: Promise<void>[] = [];

for (const name of allFiles) {
  const polyfill = name.slice(0, -".js".length);
  commands.push(
    Bun.build({
      entrypoints: [name],
      outdir,
      target: "browser",
      format: name.includes("stream") ? "cjs" : "esm",
      minify: { syntax: true, whitespace: true },
      define: {
        "process.env.NODE_DEBUG": "false",
        "process.browser": "true",
        "global": "globalThis",
        ...(readsBufferGlobal.has(polyfill) && { "Buffer": "__bun_Buffer" }),
      },
      plugins: [resolveForPolyfill(polyfill)],
      metafile: true,
      throw: true,
    }).then(async ({ metafile }) => {
      if (!metafile) throw new Error("This bun has no Bun.build({ metafile })");
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

      if (outfile.includes("__bun_Buffer")) {
        outfile = `import { Buffer as __bun_Buffer } from "buffer";${outfile}`;
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
