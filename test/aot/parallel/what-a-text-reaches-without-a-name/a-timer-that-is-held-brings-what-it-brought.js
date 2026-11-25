// The timer goes on to the program: what hangs on it is held as before, and no more than before.
// STATISTIC: FunctionsLowered >= 500
// STATISTIC: FunctionsLowered <= 700
const held = setTimeout(() => console.log("never"), 1000);
clearTimeout(held);
console.log("end");
