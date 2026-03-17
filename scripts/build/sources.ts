/**
 * Source list globbing.
 *
 * Patterns live in `cmake/Sources.json` (also read by glob-sources.mjs for
 * the CMake build — shared single source of truth). `globAllSources()` is
 * called on every configure — new/deleted files are picked up automatically.
 * All patterns expand in a single pass so there's one consistent filesystem
 * snapshot; callers receive a plain struct, no filesystem reads thereafter.
 *
 * Editing an existing file → ninja handles incrementally (each file is its
 * own build edge). Adding/removing a file → next configure re-globs →
 * build.ninja differs → `writeIfChanged` writes → ninja sees new graph.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BuildError, assert } from "./error.ts";

// Bun.Glob instead of node:fs globSync — the latter isn't in older bun
// versions (CI agents pin bun; we don't control when they bump).
function globSync(pattern: string, opts: { cwd: string }): string[] {
  return [...new Bun.Glob(pattern).scanSync({ cwd: opts.cwd })];
}

/**
 * All globbed source lists. Each field is absolute paths, sorted.
 *
 * Field names match the Sources.json `output` keys (minus `.txt` suffix,
 * camelCased). If you add a new entry to Sources.json, add a field here
 * AND to `fieldMap` below.
 *
 * TODO(cmake-removal): this interface + fieldMap duplicate Sources.json.
 * Once cmake is gone (no more glob-sources.mjs reading the JSON), convert
 * Sources.json to inline TS patterns here — field names ARE the keys,
 * interface derived via `keyof typeof patterns`. Single source of truth.
 */
export interface Sources {
  /** `packages/bun-error/*.{json,ts,tsx,css}` + images */
  bunError: string[];
  /** `src/node-fallbacks/*.js` */
  nodeFallbacks: string[];
  /** `src/bun.js/**\/*.classes.ts` — input to generate-classes codegen */
  zigGeneratedClasses: string[];
  /** `src/js/**\/*.{js,ts}` — built-in modules bundled at build time */
  js: string[];
  /** `src/codegen/*.ts` — the codegen scripts themselves */
  jsCodegen: string[];
  /** `src/bake/**` — server-rendering runtime bundled into binary */
  bakeRuntime: string[];
  /** `src/**\/*.bind.ts` — legacy bindgen input */
  bindgen: string[];
  /** `src/**\/*.bindv2.ts` — v2 bindgen input */
  bindgenV2: string[];
  /** `src/codegen/bindgenv2/**\/*.ts` — bindgen v2 generator code */
  bindgenV2Internal: string[];
  /** `src/**\/*.zig` — NOT filtered; includes codegen-written files (see bun.ts) */
  zig: string[];
  /** All `*.cpp` compiled into bun (bindings, webcore, v8 shim, usockets) */
  cxx: string[];
  /** All `*.c` compiled into bun (usockets, llhttp, uv polyfills) */
  c: string[];
}

interface SourcePattern {
  output: string;
  paths: string[];
  exclude?: string[];
}

/**
 * Glob all source lists from `cmake/Sources.json`. Called once per configure.
 */
export function globAllSources(cwd: string): Sources {
  const specPath = resolve(cwd, "cmake", "Sources.json");
  let specs: SourcePattern[];
  try {
    specs = JSON.parse(readFileSync(specPath, "utf8")) as SourcePattern[];
  } catch (cause) {
    throw new BuildError("Could not read Sources.json", { file: specPath, cause });
  }

  // Map output name → field name. New entries in Sources.json MUST be added
  // here or configure fails — catches drift between the JSON and this struct.
  const fieldMap: Record<string, keyof Sources> = {
    "BunErrorSources.txt": "bunError",
    "NodeFallbacksSources.txt": "nodeFallbacks",
    "ZigGeneratedClassesSources.txt": "zigGeneratedClasses",
    "JavaScriptSources.txt": "js",
    "JavaScriptCodegenSources.txt": "jsCodegen",
    "BakeRuntimeSources.txt": "bakeRuntime",
    "BindgenSources.txt": "bindgen",
    "BindgenV2Sources.txt": "bindgenV2",
    "BindgenV2InternalSources.txt": "bindgenV2Internal",
    "ZigSources.txt": "zig",
    "CxxSources.txt": "cxx",
    "CSources.txt": "c",
  };

  const result = {} as Sources;
  const seen = new Set<keyof Sources>();

  for (const spec of specs) {
    const field = fieldMap[spec.output];
    assert(field !== undefined, `Unknown Sources.json entry: ${spec.output}`, {
      file: specPath,
      hint: `Add a mapping in scripts/build/sources.ts fieldMap and a field to the Sources interface`,
    });

    const excludes = new Set((spec.exclude ?? []).map(normalize));
    const files: string[] = [];
    for (const pattern of spec.paths) {
      for (const rel of globSync(pattern, { cwd })) {
        const normalized = normalize(rel);
        if (excludes.has(normalized)) continue;
        files.push(resolve(cwd, normalized));
      }
    }

    files.sort((a, b) => a.localeCompare(b));
    assert(files.length > 0, `Source list ${spec.output} matched nothing`, {
      file: specPath,
      hint: `Patterns: ${spec.paths.join(", ")}`,
    });

    result[field] = files;
    seen.add(field);
  }

  // Verify all fields populated — catches a Sources.json entry being deleted
  // without updating this struct.
  for (const field of Object.values(fieldMap)) {
    assert(seen.has(field), `Sources.json missing entry for ${field}`, { file: specPath });
  }

  return result;
}

/** Forward slashes, no leading ./ — for exclude-set comparisons. */
function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
