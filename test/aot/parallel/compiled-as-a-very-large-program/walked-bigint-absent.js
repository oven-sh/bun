// Flags: --aot-heat=ReadOffStructure
// As walked-m1.js: the name that a walk hands out is kept in a member; one kind of name a file.
const TABLE = { 10n: 1 };
function make() { return { n: 0 }; }
function cold(x, table) { let z = 1; z += z * 3; z ^= z << 2; z -= z >> 1; z |= 5; z += z * 7; z ^= z << 3; z -= z >> 2; z |= 9; z += z * 11; z ^= z << 1; z -= z >> 3; z += z * 13; z ^= z << 4; z -= z >> 1; z |= 17; if (z === 123456789) console.log("never", z); for (const k in (TABLE)) x.q = k; return z; }
function read(x) { return typeof x.q + ":" + x.q + ":" + ("q" in x); }
function same(a, b) { return a.q === b.q; }
const a = make(), b = make();
cold(a, 0); console.log(read(a));
cold(b, 0); console.log(read(b), same(a, b));
