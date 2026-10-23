// An `import()` in code that folding removed is never resolved, so a missing file is not an error. The same `import()` in live code is an error.
if (false) {
  import("./does-not-exist");
}
import("./does-not-exist");
export {};
