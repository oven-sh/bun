const ledger = { good: 0, bad: 0, reads: 0 };
const source = { get value() { ledger.reads = ledger.reads + 1; return 2; } };
const coin = { valueOf() { ledger.reads = ledger.reads + 10; return 1; } };
function record(amount: number): number {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (amount % 7 === 3) { ledger.bad = ledger.bad + 1; throw new RangeError("odd"); }
  ledger.good = ledger.good + amount;
  return work;
}
function fetch(): number {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return source.value + work;
}
function weigh(): number {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return (coin as any) * 2 + work;
}
function inner(amount: number): number {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const bad = ledger.bad, good = ledger.good;
  record(amount);
  return (ledger.bad - bad) * 1000 + (ledger.good - good) + work;
}
function outer(amount: number): number {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const bad = ledger.bad, reads = ledger.reads;
  let answer = 0;
  try { answer = inner(amount); } catch (e) { answer = (ledger.bad - bad) * 1000; }
  fetch(); weigh();
  return answer + (ledger.reads - reads) * 100000 + work;
}
let total = 0;
for (let n = 0; n < 300; n++) total += outer(n);
console.log(total, ledger.good, ledger.bad, ledger.reads);
