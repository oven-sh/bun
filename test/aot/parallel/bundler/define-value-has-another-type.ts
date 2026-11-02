// A `--define` whose value is one name reads the parameter of that name, a number where the program declares the defined name a string.
// Flags: --define NAME=target
declare const NAME: string;
function read(target: number) {
  return NAME;
}
console.log(read(42), typeof read(42));
export {};
