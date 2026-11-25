// `step.done` off what the engine's own `next` answers with: no layout of the program, whatever is written of it.
type Step = { done: boolean; value: number } | { done: true; value: undefined; reason?: string } | { value: number };
function sumByHand(list: number[]): number {
  const it = list[Symbol.iterator]();
  let total = 0;
  for (let step = it.next() as Step; !(step as { done?: boolean }).done; step = it.next() as Step) total += step.value as number;
  return total;
}
function own(n: number): Step { return n & 1 ? { done: false, value: n } : n & 2 ? { done: true, value: undefined, reason: "end" } : { value: n }; }
let seen = 0;
for (let i = 0; i < 64; i++) { const step = own(i); if ((step as { done?: boolean }).done) seen++; }
const list: number[] = [];
for (let i = 0; i < 100; i++) list.push(i);
let total = 0;
for (let round = 0; round < 50; round++) total += sumByHand(list);
console.log(total, seen);
