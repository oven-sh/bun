// tsc and `bun check` take the variables of a script for globals. Bun runs every file as a module, and nothing loads never-runs.ts: each read is a ReferenceError in plain Bun, and the build says so.
function attempt(read: () => unknown): string {
  try {
    return String(read());
  } catch (error) {
    return error instanceof ReferenceError ? "ReferenceError" : "another error";
  }
}
console.log(attempt(() => shared), attempt(() => shared + 1), attempt(() => counted), attempt(() => helper()), typeof shared, typeof helper);
export {};
