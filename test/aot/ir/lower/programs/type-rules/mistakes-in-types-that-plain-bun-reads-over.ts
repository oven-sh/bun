// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS7061 1
// DIAGNOSTIC: TS5085 1
// DIAGNOSTIC: TS1099 1
// DIAGNOSTIC: TS1009 1
// DIAGNOSTIC: TS1021 1
// DIAGNOSTIC: TS17019 2
// DIAGNOSTIC: TS2574 1
// DIAGNOSTIC: TS2369 1
// DIAGNOSTIC: TS2371 2
// DIAGNOSTIC: TS1206 1
// DIAGNOSTIC: TS1014 1

// Plain Bun runs a file with these four. The parser flags them as mistakes in TypeScript's grammar, which costs no look at the file, and in a source file of the program such a mistake stops the build.
// The rest is what plain Bun runs and nobody flags without a check of the whole file: a build flags it as `bun check` does.
type MappedWithMember = { [K in "a"]: number; extra: string };
type RestAndOptional = [...rest?: string[]];
function generic<T = number>() { return 1; }
console.log(generic<>(), generic<number,>());

interface NoTypeOfValues { [key: string] }
type OptionalRest = [...string?];
let bangBehind: number! = 1;
class Overloads {
  constructor(public size: number);
  constructor(...all: unknown[]) {}
  resize(size: number = 1): void;
  resize(@mark size: string): void;
  resize(...all: unknown[]) {}
}
function mark(...all: unknown[]) {}
declare function withDefault(size: number = 1): void;
interface RestNotLast { resize(...sizes: number[], last: number): void }
console.log(bangBehind, typeof Overloads);
export {};
