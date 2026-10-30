// A global the program sets once.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
declare var foo: number;
(globalThis as any).foo = 1;
function twice(): number {
  return foo + foo;
}
function total(rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += foo;
  return sum;
}
console.log(foo, typeof foo, twice(), twice(), total(100), (globalThis as any).foo);
export {};
