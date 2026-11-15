// A file that an import call loads steps a generator whose loop reads a parsed list; every name is declared.
try {
  await import("./p0.ts");
} catch (error) {
  console.log(error.name);
}
