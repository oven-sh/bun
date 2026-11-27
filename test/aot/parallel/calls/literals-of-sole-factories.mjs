// A closure made by the only call of its factory reads the literals that the call passes: counted up and down past int32, overwritten parameters, defaults, throws.
function limited(f, max) { let c = 0; return x => (c++ % max === 0 ? f(x) : -1); } const f = limited(x => x * 2, 3);
function repeat(turns) { let n = 0; for (let k = 0; k < turns; k++) { n += f(k & 7); } return n; }
console.log(repeat(0), repeat(1), repeat(1000), repeat(7));
function counter(start, step) { let c = start; return { next: () => c++, back: () => c--, read: () => c, set(v) { c = v; }, step: () => (c += step) }; }
const count = counter(2147483640, 3);
function steps(turns) { let n = 0; for (let k = 0; k < turns; k++) n += count.next() % 5; return [n, count.read()]; }
console.log(steps(4), steps(20), steps(3)); count.set(-2147483644); 
function down(turns) { let n = 0; for (let k = 0; k < turns; k++) n += count.back(); return [n, count.read()]; }
console.log(down(3), down(20)); count.set(0.5); console.log(steps(5), down(5)); count.set("7"); console.log(steps(3), down(4)); count.set(9007199254740990); console.log(steps(6)); count.set(undefined); console.log(steps(2)); count.set(3n); try { console.log(steps(2)); } catch (error) { console.log(error.constructor.name, count.read()); }
count.set(-0); console.log(count.step(), steps(2));
function padded(width, fill = "0") { let made = 0; return v => { made++; let s = String(v); while (s.length < width) s = fill + s; return s + made; }; } const pad = padded(4);
function texts(turns) { let s = ""; for (let k = 0; k < turns; k++) s = pad(k * k); return s; }
console.log(texts(30), texts(0));
function guarded(limit) { let calls = 0; return x => { if (calls >= limit) throw new RangeError("after " + calls); calls++; return x; }; } const once = guarded(5);
function tried(turns) { let n = 0; for (let k = 0; k < turns; k++) { try { n += once(k); } catch (error) { n += 1000; } } return n; }
console.log(tried(3), tried(9));
function shadowed(max) { let c = 0; return x => { max = x ? max : -max; return c++ * max; }; } const s = shadowed(2);
function shadows(turns) { let n = 0; for (let k = 0; k < turns; k++) n += s(k & 1); return n; }
console.log(shadows(9), shadows(4));
