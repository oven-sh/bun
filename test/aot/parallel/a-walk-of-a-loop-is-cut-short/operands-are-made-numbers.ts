// An operator on numbers first makes numbers of its operands and then asks which form they allow. Where the walk of the loop was cut short at the making, the compiler died.
// Under: --aot-testing=AbortLoopVisits:10:0: without the word no walk of this loop is cut short
function count(flags: boolean[]) {
  let total = 0;
  for (let i = 0; i < flags.length; i++) total += +flags[i] - (flags[i] as any) * 2;
  return total;
}
console.log(count([true, false, true]));
