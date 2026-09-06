import * as fs from "fs";
import * as Module from "module";
import * as zlib from "zlib";

const allFiles = fs.readdirSync(".").filter(f => f.endsWith(".js"));
const outdir = process.argv[2];
const builtins = new Set(Module.builtinModules);

// Every node builtin stays a bare `require("x")` / `import "x"` in the output.
// The user's `--target=browser` build resolves it to the matching polyfill, so
// one `Buffer` (or `EventEmitter`, or `Stream`) is shared by all of them.
//
// The polyfills are bundled with `target: "browser"` so the npm packages
// resolve through their `browser` field. `crypto-browserify` depends on it:
// the node `main` of `randombytes`, `create-hash`, `create-hmac` and `pbkdf2`
// is `require("crypto").X`, which in a browser bundle is the polyfill itself.
//
// `external` cannot express this: with the browser target the resolver picks
// the polyfill before it checks the externals list. A plugin runs first.
const keepBuiltinsExternal: Bun.BunPlugin = {
  name: "keep node builtins external",
  setup(build) {
    build.onResolve({ filter: /^(node:)?[a-z0-9_]+(\/[a-z0-9_]+)*$/ }, args => {
      const bare = args.path.startsWith("node:") ? args.path.slice("node:".length) : args.path;
      if (builtins.has(bare) || builtins.has(`node:${bare}`)) {
        return { path: args.path, external: true };
      }
      return undefined;
    });
  },
};

// `require` in the browser output is the runtime's `__require` shim. The text
// is rewritten to a plain `require(...)` below, which leaves the shim unused.
const requireShim = /var __require=\(\(x\)=>typeof require<"u"\?require:.*?is not supported'\)\}\);/;

let commands: Promise<void>[] = [];

for (const name of allFiles) {
  commands.push(
    Bun.build({
      entrypoints: [name],
      outdir,
      target: "browser",
      format: name.includes("stream") ? "cjs" : "esm",
      minify: { syntax: true, whitespace: true },
      define: {
        "process.env.NODE_DEBUG": "false",
        "process.env.READABLE_STREAM": "'enable'",
        "global": "globalThis",
      },
      plugins: [keepBuiltinsExternal],
      throw: true,
    }).then(async () => {
      // This is very brittle. But that should be okay for our usecase
      let outfile = fs
        .readFileSync(`${outdir}/${name}`, "utf8")
        .replaceAll("__require(", "require(")
        .replace(requireShim, "")
        .replaceAll("global.process", "require('process')")
        .trim();

      if (outfile.includes("__require")) {
        throw new Error("Unexpected __require in " + name);
      }

      if (outfile.includes('"node:module"')) {
        console.log(outfile);
        throw new Error("Unexpected import in " + name);
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
