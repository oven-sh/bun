/**
 * Source list globbing.
 *
 * `globAllSources()` is called on every configure — new/deleted files are
 * picked up automatically. All patterns expand in a single pass so there's
 * one consistent filesystem snapshot; callers receive a plain struct, no
 * filesystem reads thereafter.
 *
 * Also runnable as a CLI to print a single list (for run-clang-format.sh,
 * ad-hoc inspection):
 *
 *   bun scripts/glob-sources.ts cxx    # one .cpp path per line
 *   bun scripts/glob-sources.ts        # list available fields
 */

import { globSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert } from "./build/error.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface SourcePattern {
  paths: string[];
  exclude?: string[];
}

/**
 * Source patterns. Field name → glob patterns (relative to repo root).
 *
 * To add a new source list: add an entry here. The `Sources` type and
 * `globAllSources()` pick it up automatically.
 */
const patterns = {
  /** `packages/bun-error/*` — error overlay page */
  bunError: {
    paths: ["packages/bun-error/*.{json,ts,tsx,css}", "packages/bun-error/img/*"],
  },
  /** `src/node-fallbacks/*.js` */
  nodeFallbacks: {
    paths: ["src/node-fallbacks/*.js"],
  },
  /** `*.classes.ts` — input to generate-classes codegen */
  zigGeneratedClasses: {
    paths: ["src/bun.js/*.classes.ts", "src/bun.js/{api,node,test,webcore}/*.classes.ts", "src/image/*.classes.ts"],
  },
  /** built-in modules bundled at build time */
  js: {
    paths: ["src/js/**/*.{js,ts}", "src/install/PackageManager/scanner-entry.ts"],
  },
  /** the codegen scripts themselves */
  jsCodegen: {
    paths: ["src/codegen/*.ts"],
  },
  /** server-rendering runtime bundled into binary */
  bakeRuntime: {
    paths: ["src/bake/*.ts", "src/bake/*/*.{ts,css}"],
    exclude: ["src/bake/generated.ts"],
  },
  /** legacy bindgen input */
  bindgen: {
    paths: ["src/**/*.bind.ts"],
  },
  /** v2 bindgen input */
  bindgenV2: {
    paths: ["src/**/*.bindv2.ts"],
  },
  /** bindgen v2 generator code */
  bindgenV2Internal: {
    paths: ["src/codegen/bindgenv2/**/*.ts"],
  },
  /** NOT filtered; includes codegen-written files (see bun.ts) */
  zig: {
    paths: ["src/**/*.zig"],
  },
  /** all `*.cpp` compiled into bun (bindings, webcore, v8 shim, usockets) */
  cxx: {
    paths: [
      "src/io/*.cpp",
      "src/bun.js/modules/*.cpp",
      "src/bun.js/bindings/*.cpp",
      "src/bun.js/bindings/webcore/*.cpp",
      "src/bun.js/bindings/sqlite/*.cpp",
      "src/bun.js/bindings/webcrypto/*.cpp",
      "src/bun.js/bindings/webcrypto/*/*.cpp",
      "src/bun.js/bindings/node/*.cpp",
      "src/bun.js/bindings/node/crypto/*.cpp",
      "src/bun.js/bindings/node/http/*.cpp",
      "src/bun.js/bindings/v8/*.cpp",
      "src/bun.js/bindings/v8/shim/*.cpp",
      "src/bun.js/webview/*.cpp",
      "src/bake/*.cpp",
      "src/deps/*.cpp",
      "src/vm/*.cpp",
      "packages/bun-usockets/src/crypto/*.cpp",
    ],
  },
  /** all `*.c` compiled into bun (usockets, llhttp, uv polyfills) */
  c: {
    paths: [
      "packages/bun-usockets/src/*.c",
      "packages/bun-usockets/src/eventing/*.c",
      "packages/bun-usockets/src/internal/*.c",
      "packages/bun-usockets/src/crypto/*.c",
      "src/bun.js/bindings/uv-posix-polyfills.c",
      "src/bun.js/bindings/uv-posix-stubs.c",
      "src/*.c",
      "src/bun.js/bindings/node/http/llhttp/*.c",
    ],
  },
} satisfies Record<string, SourcePattern>;

/**
 * All globbed source lists. Each field is absolute paths, sorted.
 * Derived from `patterns` — add a pattern there and it appears here.
 */
export type Sources = { [K in keyof typeof patterns]: string[] };

/**
 * Glob all source lists. Called once per configure.
 */
export function globAllSources(): Sources {
  const result = {} as Sources;

  for (const [field, spec] of Object.entries(patterns) as [keyof Sources, SourcePattern][]) {
    const excludes = new Set((spec.exclude ?? []).map(normalize));
    const files: string[] = [];
    for (const pattern of spec.paths) {
      for (const rel of globSync(pattern, { cwd: root })) {
        const normalized = normalize(rel);
        if (excludes.has(normalized)) continue;
        files.push(resolve(root, normalized));
      }
    }

    files.sort((a, b) => a.localeCompare(b));
    assert(files.length > 0, `Source list '${field}' matched nothing`, {
      file: import.meta.url,
      hint: `Patterns: ${spec.paths.join(", ")}`,
    });

    result[field] = files;
  }

  return result;
}

/** Forward slashes, no leading ./ — for exclude-set comparisons. */
function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

// ───────────────────────────────────────────────────────────────────────────
// CLI — print one source list to stdout.
// ───────────────────────────────────────────────────────────────────────────

if (process.argv[1] === import.meta.filename) {
  const arg = process.argv[2];
  const sources = globAllSources();
  const print = (list: string[]) => {
    for (const abs of list) console.log(relative(root, abs).replaceAll("\\", "/"));
  };

  if (arg === "--all") {
    for (const list of Object.values(sources)) print(list);
  } else if (arg && arg in sources) {
    print(sources[arg as keyof Sources]);
  } else {
    const msg = arg ? `unknown field '${arg}'` : "usage: bun scripts/glob-sources.ts <field>|--all";
    console.error(`${msg}\nfields: ${Object.keys(sources).join(", ")}`);
    process.exit(1);
  }
}
