// Callbacks handed over: a FinalizationRegistry calls its function with the held value, a string here, some time after a collection, while the program's own call passes a number.
export {};

let seen = 0;

function cleanUp(held: number): void {
  seen |= typeof held === "number" ? 1 : typeof held === "string" ? 2 : 4;
}

cleanUp(1);
const registry = new FinalizationRegistry(cleanUp as (held: any) => void);
function fill(): void {
  for (let i = 0; i < 2000; i++) registry.register({ i }, "held " + i);
}
fill();
for (let round = 0; round < 50 && seen === 1; round++) {
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 5));
}
console.log(seen);
