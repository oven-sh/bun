// A `--define` whose value is one name reads the `const` of the file that has that name, from inside a function.
// Flags: --define NAME=target
declare const NAME: string;
const target = "the binding of the file";
function read(): string {
  return NAME;
}
console.log(read());
export {};
