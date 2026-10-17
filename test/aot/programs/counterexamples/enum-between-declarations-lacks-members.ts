// Between two declarations of an enum, its object has only the members of the first.
declare const console: { log(...a: unknown[]): void };
enum E { A }
console.log("B" in E);
enum E { B = 1 }
