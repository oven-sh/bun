// STATISTIC: CopiedVariablesCarried >= 1
// A replaced Math.random computes a variable of the file by several stores: the loop that copies it carries the variable round its turns.
let seed;
function reset(to) { seed = to; }
reset(49734321);
Math.random = (function () {
  return function () {
    seed = ((seed + 0x7ed55d16) + (seed << 12)) & 0xffffffff;
    seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff;
    seed = ((seed + 0x165667b1) + (seed << 5)) & 0xffffffff;
    return (seed & 0xfffffff) / 0x10000000;
  };
})();
function fill(count) { var bytes = new Uint8Array(count); for (var i = 0; i < count; i++) bytes[i] = (Math.random() * 255) >>> 0; return bytes; }
function sum(bytes) { var s = 0; for (var i = 0; i < bytes.length; i++) s = (s * 31 + bytes[i]) | 0; return s; }
console.log(sum(fill(0)), sum(fill(1)), sum(fill(100)), sum(fill(1000)));
reset(0); console.log(sum(fill(3)), seed); reset(-1); console.log(sum(fill(20)), seed); reset(2147483647); console.log(sum(fill(1)), seed); reset(undefined); console.log(sum(fill(2)), seed);
