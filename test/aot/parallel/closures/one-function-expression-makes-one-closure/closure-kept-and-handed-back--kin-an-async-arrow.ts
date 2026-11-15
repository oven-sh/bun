const listeners = new Set();
let notes = 0;
function note(sum: any) {
  for (let turn = 0; turn < 2; turn++) notes += sum;
}
function listen(listener: any) {
  let sum = 0;
  for (let turn = 0; turn < 3; turn++) sum += turn;
  listeners.add(listener);
  note(sum);
  return listeners.size;
}
function subscribe(listener: any, open: any) {
  if (!open) return null;
  listen(listener);
  return listener;
}
function main(round: any) {
  let total = 0;
  for (let at = 0; at < 6; at++) {
    listeners.clear();
    const handle = subscribe(async () => at + round, at % 3 !== 0);
    if (handle === null) continue;
    total += (listeners.has(handle) ? 100 : 0) + (listeners.delete(handle) ? 10 : 0) + listeners.size;
  }
  return total;
}
let all = 0;
for (let round = 0; round < 3; round++) all += main(round);
console.log(all, notes);
