// Prints hashes that `>>>=` and `>>> 0` store: whole numbers up to 2 ** 32 - 1, so about half of them lie above every int32. The member, the variable and the parameter that hold them are operands of `^` too, which yields an int32.
function mix(state, bits) {
  state.hash ^= bits;
  state.hash >>>= 0;
  return state.hash;
}
function mixWrittenOut(state, bits) {
  state.hash = (state.hash ^ bits) >>> 0;
  return state.hash;
}
function mixVariable(hash, bits) {
  hash ^= bits;
  hash >>>= 0;
  return hash;
}
function at(list, index) {
  index >>>= 0;
  return list[index];
}
const first = { hash: 1 };
const second = { hash: 1 };
let third = 1;
let sum = 0;
let above = 0;
for (let i = 0; i < 5000; i++) {
  const bits = i % 3 === 0 ? 0x80000000 + i : i * 2654435761;
  sum += mix(first, bits) % 1000;
  sum += mixWrittenOut(second, bits) % 1000;
  third = mixVariable(third, bits);
  if (third > 0x7fffffff) above++;
}
console.log(first.hash, second.hash, third, sum, above);
const list = [3, 1, 4, 1, 5];
console.log(at(list, 2), at(list, -1), at(list, 4294967296 + 3), at(list, 1.9), at(list, "4"), at(list, undefined));
