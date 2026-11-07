// Of two values that nobody knows `+` may give a bigint. The host warns about it where it is asked to, and what prints the warning is in the program: it lays no listener that would bring it in by another road.
// Env: BUN_OPTIONS=--pending-deprecation
const one = BigInt(JSON.parse("1"));
process.env.MADE_UP_SUM = one + one;
console.log(process.env.MADE_UP_SUM);
