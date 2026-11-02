// A package that ships its TypeScript, in an application with an older target.
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# a-package-that-ships-its-typescript-stays-typed-where-only-t");
await import("./a-package-that-ships-its-typescript-stays-typed-where-only-t/main.ts");
await settled();
