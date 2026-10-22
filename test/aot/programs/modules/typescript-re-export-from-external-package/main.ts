// A file re-exports names of an external package, whose names are known only at run time. A name that the package does not export may be a type, so a TypeScript file links without it; plain Bun, which reads no types, throws a SyntaxError. A name that is ambiguous in the package is a SyntaxError in TypeScript too, and a JavaScript file gets both errors.
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
