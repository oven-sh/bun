export const isJavaScriptCore: boolean =
  !("process" in globalThis) && !("location" in globalThis);
