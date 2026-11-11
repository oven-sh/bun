export function* loads() {
  yield new Function("return import(\"./dep.mjs\")")();
}
