// `o?.#x`, `o.#x?.y`, `o?.#m()`, delete and typeof around private names, in JavaScript.
class Box { #v = { y: 1 }; #n = null; #m() { return 7; } static v(o) { return o?.#v; } static y(o) { return o.#v?.y; } static n(o) { return o.#n?.y; } static m(o) { return o?.#m(); } static t(o) { return typeof o.#v + typeof o.#n + typeof o.#m; } }
function attempt(name, f) { try { console.log(name, JSON.stringify(f())); } catch (e) { console.log(name, e instanceof TypeError, e.constructor.name); } }
const b = new Box();
for (let round = 0; round < 3; round++) for (const [name, o] of [["b", b], ["null", null], ["undefined", undefined], ["{}", {}], ["1", 1]]) {
  attempt(name + " v", () => Box.v(o)); attempt(name + " y", () => Box.y(o)); attempt(name + " n", () => Box.n(o)); attempt(name + " m", () => Box.m(o)); attempt(name + " t", () => Box.t(o));
}
