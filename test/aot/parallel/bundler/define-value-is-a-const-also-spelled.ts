// A `--define` whose value is one name reads the `const` of that name, which the file also reads by its own name.
// Flags: --define NAME=target
declare const NAME: string;
const target = ["the", "binding"].join(" ");
function read(): string {
  return NAME;
}
console.log(read(), target.length);
export {};
