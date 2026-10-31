// In a TypeScript file a `--define` whose value is one name reads the `const` of the file that has that name, where no global of that name exists.
// Flags: --define NAME=target
declare const NAME: string;
const target = "the binding of the file";
console.log(NAME);
export {};
