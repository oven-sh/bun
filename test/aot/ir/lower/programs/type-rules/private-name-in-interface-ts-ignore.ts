// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS18016 1

// Plain Bun rejects a private name in an interface while parsing, so `@ts-ignore` does not suppress the error in a compiled file.
interface Shape {
  // @ts-ignore
  #name: number;
}
console.log("never printed");
export {};
