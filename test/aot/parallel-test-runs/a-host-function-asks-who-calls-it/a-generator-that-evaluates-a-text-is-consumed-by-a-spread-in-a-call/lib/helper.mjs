export function* loads() {
  yield (0, eval)("import(\"./dep.mjs\")");
}
