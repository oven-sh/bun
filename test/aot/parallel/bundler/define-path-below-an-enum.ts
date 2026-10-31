// A `--define` whose value is a dotted path reads a member of an enum of the file, from inside a function.
// Flags: --define PICK=Color.Green
declare const PICK: number;
enum Color {
  Red,
  Green,
}
function read(): number {
  return PICK;
}
console.log(read());
export {};
