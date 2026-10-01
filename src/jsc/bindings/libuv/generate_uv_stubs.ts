import { join } from "path";
import { exported, symbols } from "./generate_uv_stubs_constants";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

async function writeC(path: string, contents: string) {
  await Bun.write(path, contents);
  if (Bun.which("clang-format")) {
    await Bun.$`clang-format -i ${path}`.quiet();
  }
}

await writeC(
  join(import.meta.dir, "../uv-stubs.c"),
  `// GENERATED CODE - DO NOT MODIFY BY HAND
#include "uv-polyfills.h"

// A stub reads none of its arguments and does not return, so it has no use for
// the function's prototype.
#define STUB(name) UV_EXTERN void name(void) { __bun_throw_not_implemented(#name); __builtin_unreachable(); }

${symbols.map(name => `STUB(${name})`).join("\n")}
`,
);

/**
 * The linker export lists each carry the uv_* names as one contiguous run of
 * lines. Make that run hold exactly `exported`: names already listed keep
 * their place, removed ones go, new ones are appended.
 */
async function syncExportList(file: string, line: (name: string) => string) {
  const path = join(import.meta.dir, "../../../", file);
  const text = await Bun.file(path).text();
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const isUv = (l: string) => /^\s*_?uv_\w+;?$/.test(l);
  const first = lines.findIndex(isUv);
  const last = lines.findLastIndex(isUv);
  assert(first !== -1, `${file}: no uv_* names found`);
  assert(lines.slice(first, last + 1).every(isUv), `${file}: uv_* names are not contiguous`);
  const wanted = new Set(exported);
  const kept = lines
    .slice(first, last + 1)
    .map(l => l.match(/uv_\w+/)![0])
    .filter(name => wanted.has(name));
  const listed = new Set(kept);
  const names = [...kept, ...exported.filter(name => !listed.has(name))];
  lines.splice(first, last - first + 1, ...names.map(line));
  await Bun.write(path, lines.join(eol));
}

await syncExportList("symbols.def", name => `  ${name}`);
await syncExportList("symbols.txt", name => `_${name}`);
await syncExportList("linker.lds", name => `  ${name};`);
await syncExportList("linker-freebsd.lds", name => `  ${name};`);

await writeC(
  join(import.meta.dir, "../../../../test/napi/uv-stub-stuff/plugin.c"),
  `// GENERATED CODE - DO NOT MODIFY BY HAND
#include <node_api.h>

#include <stdio.h>
#include <string.h>

#define UV_FUNCTIONS(X) \\
${symbols.map(name => `  X(${name})`).join(" \\\n")}

// Declared and called without arguments: a stub reads none.
#define DECLARE(name) extern void name(void);
UV_FUNCTIONS(DECLARE)

#define ENTRY(name) { #name, name },
static const struct {
  const char* name;
  void (*function)(void);
} uv_functions[] = { UV_FUNCTIONS(ENTRY) };

napi_value call_uv_func(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok || argc < 1) {
    napi_throw_error(env, NULL, "Wrong number of arguments");
    return NULL;
  }

  char name[256];
  if (napi_get_value_string_utf8(env, arg, name, sizeof(name), NULL) != napi_ok) {
    napi_throw_error(env, NULL, "Failed to get string value");
    return NULL;
  }
  printf("Got string: %s\\n", name);

  for (size_t i = 0; i < sizeof(uv_functions) / sizeof(uv_functions[0]); i++) {
    if (strcmp(name, uv_functions[i].name) == 0) {
      uv_functions[i].function();
      return NULL;
    }
  }

  napi_throw_error(env, NULL, "Function not found");
  return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value function;
  if (napi_create_function(env, NULL, 0, call_uv_func, NULL, &function) != napi_ok ||
      napi_set_named_property(env, exports, "callUVFunc", function) != napi_ok) {
    napi_throw_error(env, NULL, "Failed to export callUVFunc");
    return NULL;
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
`,
);
