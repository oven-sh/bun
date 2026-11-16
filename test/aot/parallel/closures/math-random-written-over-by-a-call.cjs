// STATISTIC: BuiltinMembersReplacedByFunctions >= 1
// Math.random is written over by what a call returns, by a function in a variable and by a method: loops call the function that is there.
let seed;
function resetSeed() { seed = 49734321; }
resetSeed();
Math.random = (function () {
  return function () {
    seed = (seed + 0x7ed55d16 + (seed << 12)) & 0xffffffff;
    seed = (seed ^ 0xc761c23c ^ (seed >>> 19)) & 0xffffffff;
    seed = (seed + 0x165667b1 + (seed << 5)) & 0xffffffff;
    seed = ((seed + 0xd3a2646c) ^ (seed << 9)) & 0xffffffff;
    seed = (seed + 0xfd7046c5 + (seed << 3)) & 0xffffffff;
    seed = (seed ^ 0xb55a4f09 ^ (seed >>> 16)) & 0xffffffff;
    return (seed & 0xfffffff) / 0x10000000;
  };
})();
function fill(bytes) {
  const view = new Uint8Array(bytes);
  for (let i = 0; i < bytes; ++i) view[i] = (Math.random() * 255) >>> 0;
  return view.join();
}
console.log(fill(24));
resetSeed();
console.log(fill(6), [1, 2].map(Math.random).join(), typeof Math.random.call(null));
