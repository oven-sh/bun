// Flags: --aot-heat=ReadOffStructure
// The name that a walk hands out is kept in a member, in a function that a very large program ranks cold. One of 22 forms; walked-key.js says what went wrong.
const x = { p: "" };
class R { word = 1; }
function cold() { let z = 1; z += z * 3; z ^= z << 2; z -= z >> 1; z |= 5; z += z * 7; z ^= z << 3; z -= z >> 2; z |= 9; z += z * 11; z ^= z << 1; z -= z >> 3; z += z * 13; z ^= z << 4; z -= z >> 1; z |= 17; if (z === 123456789) console.log("never", z); for (x.p in new R()); return x.p; }
console.log(cold());
console.log(cold());
