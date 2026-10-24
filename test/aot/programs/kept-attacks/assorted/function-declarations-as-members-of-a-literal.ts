// Assorted: function declarations as members of a literal. It prints what plain Bun prints.
interface Counter { get(): number; step(): void; reset(): void; twice(): void }
function make(start: number, text?: string): Counter {
  let pos = start;
  let end = text === undefined ? 0 : text.length;
  const counter: Counter = {
    get: () => pos + end,
    step,
    reset,
    twice,
  };
  return counter;
  function step() { pos++; }
  function reset() { pos = 0; end = 0; }
  function twice() { step(); step(); }
}
let sum = 0;
for (let i = 0; i < 1000; i++) { const c = make(i, i % 2 ? "ab" : undefined); c.step(); sum += c.get(); }
console.log(sum);
