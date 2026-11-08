// Flags: --aot-harden=proof-checks
class Plain { take(more, give) { return give() + more; } }
class Other extends Plain { take(more, give) { return give() + more + 1; } }
let held = new Plain();
let sum = 0;
for (let turn = 0; turn < 4; turn++) {
  if (turn === 2) held = new Other();
  sum += held.take(turn, () => turn);
}
console.log(sum);
