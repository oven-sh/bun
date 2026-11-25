// Methods that read and store private names, called in loops with instances, others, nothing and the class itself.
class R { #x = 1; static #n = 5; static at(o) { return o.#x + R.#n; } static step() { return (R.#n = (R.#n * 5 + 1) & 1023); } set(v) { this.#x = v; return this; } static put(o, v) { o.#x = v; return v; } static has(o) { return #x in o; } static call(o) { return o.#m(); } #m() { return this.#x * 2; } get v() { return this.#x; } static wrong(o) { return o.#n; } }
class S extends R { y = 2; }
function steps(turns) { let n = 0; for (let k = 0; k < turns; k++) n += R.step(); return n; }
console.log(steps(1000), R.step());
function each(list, f) { let s = ""; for (let i = 0; i < list.length; i++) { const o = list[i]; try { s += f(o, i) + " "; } catch (e) { s += e.name + " "; } } return s; }
const list = [new R(), new S(), {}, null, undefined, 5, R, Object.create(new R()), new Proxy(new R(), {}), new R().set(9)];
for (let round = 0; round < 3; round++) {
    console.log(each(list, o => R.at(o)));
    console.log(each(list, (o, i) => R.put(o, i)));
    console.log(each(list, o => R.call(o)));
    console.log(each(list, o => R.has(o)));
    console.log(each(list, o => R.wrong(o)));
}
function inTurn(o, turns) { let s = 0; for (let k = 0; k < turns; k++) { s += R.at(o); R.put(o, k); s += o.v; } return s; }
console.log(inTurn(new R(), 50), inTurn(new S(), 50));
try { inTurn({}, 3); } catch (e) { console.log(e.name); }
try { let s = 0; for (const o of list) s += R.at(o); } catch (e) { console.log(e.name); }
