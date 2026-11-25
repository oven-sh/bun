// A loop that moves elements counts in a variable of the file. It is copied into the body of the file, behind the variable's store.
let n = 0, moved = 0;
const hands = {
  lay(jar, at, beans, first, count) { for (let left = count; left > 0; left--) { jar[at] = beans[first]; n++; at++; first++; } return jar; },
  back(jar, beans, count) { while (count > 0) { count--; jar[count] = beans[count]; moved++; } return jar; },
};
class Hand { static fill(jar, count) { for (let place = 0; place < count; place++) { n++; jar[place] = 7; } return jar; } move(jar, count) { for (let place = 1; place <= count; place++) { jar[place - 1] = jar[place]; n++; } return jar; } }
const values = Array.from({ length: 24 }, (_, k) => (k * 37 + 11) & 255);
const show = value => Array.from({ length: Math.min(value.length, 12) }, (_, k) => k in value ? String(value[k]) : ".").join();
const shared = Buffer.from(values); console.log(show(hands.lay(shared, 1, shared, 0, 12)), show(hands.lay(new Uint8Array(shared.buffer, shared.byteOffset, 12), 3, shared, 0, 8)), n);
console.log(show(hands.back([], values, 12)), show(hands.back(new Float64Array(6), new Uint8Array(values), 5)), moved);
console.log(show(Hand.fill([], 4)), show(Hand.fill(new Uint8Array(3), 3)), show(new Hand().move(values.slice(), 6)), show(new Hand().move(new Uint8Array(values), 6)), n);
const attempt = f => { try { return show(f()); } catch (error) { return error.name; } };
const late = { lay(jar, beans, count) { for (let place = 0; place < count; place++) { told++; jar[place] = beans[place]; } return jar; } };
console.log(attempt(() => late.lay([], values, 3)), attempt(() => late.lay(new Uint8Array(4), shared, 3)), attempt(() => late.lay([], values, 0)));
let told = 0;
console.log(show(late.lay([], values, 3)), show(late.lay(new Uint8Array(4), shared, 3)), told);
