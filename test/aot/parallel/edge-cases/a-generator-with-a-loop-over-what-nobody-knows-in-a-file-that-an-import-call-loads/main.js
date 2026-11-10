// A file that an import call loads steps a generator whose loop reads a list and a member that nobody knows: the build once stopped.
globalThis.parse0 = [3, 0];
try {
  await import("./p0.ts");
} catch (error) {
  console.log(error.name);
}
