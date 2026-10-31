// In a TypeScript file a `--define` whose value is one name reads the `const` of the file that has that name, not the global of that name.
// Flags: --define NAME=target
declare const NAME: string;
const target = "the binding of the file";
(globalThis as any).target = "the global";
console.log(NAME);
export {};
