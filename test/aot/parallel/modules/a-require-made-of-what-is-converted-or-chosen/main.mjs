// A require() that is made at once of something that is put together, converted or chosen. Where that is not the file itself, the build does not follow it, and says so.
// Build prints: 10 x warn: TS100096: The build can't follow the require() that is made here to every call of it. If such a call names code that isn't in the executable, it throws at run time. Make it for the file's own path or URL, keep it in a const and call it by that name, or build with --aot-allow-code-from-disk
import "./a.cjs";
import "./other/a.cjs";
await import("./esm.mjs");
await import("./commonjs.cjs");
await import("./unresolved.cjs");
