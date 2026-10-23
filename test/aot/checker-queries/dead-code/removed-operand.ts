// A call in an operand that folding removed has no target. The same call in live code has one.
declare function one(): number;
const v = false ? one() : 2;
one();
