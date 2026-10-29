// A file re-exports names of an external package, whose names are known only at run time. A specifier that names only a type is erased from a TypeScript file, so the file links; plain Bun, which reads no types, asks the package for it and throws a SyntaxError.
// A name that the declarations call a value is asked for like any other: one that the package does not export, or that is ambiguous in it, is a SyntaxError in TypeScript and in JavaScript alike.
// Flags: --external outside-names
async function load(label: string, importFile: () => Promise<{ present: number }>): Promise<void> {
  try {
    console.log(label + ": present = " + (await importFile()).present);
  } catch (error) {
    console.log(label + ": " + (error instanceof SyntaxError ? "SyntaxError" : String(error)));
  }
}
await load("TypeScript, a type", () => import("./typed-type.ts"));
await load("TypeScript, a name the package does not export", () => import("./typed-absent.ts"));
await load("JavaScript, a name the package does not export", () => import("./untyped-absent.js"));
await load("TypeScript, a name that is ambiguous", () => import("./typed-ambiguous.ts"));
await load("JavaScript, a name that is ambiguous", () => import("./untyped-ambiguous.js"));
await load("TypeScript, a name the package exports", () => import("./typed-present.ts"));
/* Output:
TypeScript, a type: present = 1
TypeScript, a name the package does not export: SyntaxError
JavaScript, a name the package does not export: SyntaxError
TypeScript, a name that is ambiguous: SyntaxError
JavaScript, a name that is ambiguous: SyntaxError
TypeScript, a name the package exports: present = 1
*/
