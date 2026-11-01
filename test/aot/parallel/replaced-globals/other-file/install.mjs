export function install(f, U) {
  globalThis.setTimeout = f;
  globalThis.URL = U;
}
