export const isJavaScriptCore =
  !("process" in globalThis) && !("location" in globalThis);
