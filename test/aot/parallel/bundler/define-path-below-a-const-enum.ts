// A `--define` whose value is a dotted path reads a member of a `const enum` of the file.
// Flags: --define PICK=Color.Green
declare const PICK: number;
const enum Color {
  Red,
  Green,
}
function read(): number {
  return PICK;
}
try {
  console.log(read());
} catch (e) {
  console.log(String(e));
}
export {};
