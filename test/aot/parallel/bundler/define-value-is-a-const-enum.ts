// Plain Bun makes the object of a `const enum` as it makes the object of an enum, and a `--define` whose value is the name of the enum, or a path below it, reads that object.
// Flags: --define NAME=Color --define PICK=Color.Green
declare const NAME: any;
declare const PICK: number;
(globalThis as any).Color = "the global";
const enum Color {
  Red,
  Green = 7,
}
function read(): string {
  return [typeof NAME, NAME.Green, NAME[7], PICK, Color.Red].join(", ");
}
console.log(read());

export {};
