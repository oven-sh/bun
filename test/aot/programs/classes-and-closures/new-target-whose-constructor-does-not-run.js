class A { constructor() { this.x = 1; } }
var picked; const table = { other: Object, undefined: A }; function key() { return picked; }
class Picked extends table[key()] { #q = 2; y = 3; q() { return this.#q; } }
picked = "other";
class Below extends A { #q = 4; y = 5; q() { return this.#q; } }
class Stranger { #q = 6; y = 7; q() { return this.#q; } }
function get(v) { try { return v.q(); } catch (e) { return e.name; } }
function show(v) { return get(v) + " " + v.x + " " + v.y + " " + Object.keys(v).join() + " " + (v instanceof A); }
console.log(show(new Picked())); console.log(show(new Below())); console.log(show(new Stranger()));
console.log(show(Reflect.construct(A, [], Picked))); console.log(show(Reflect.construct(A, [], Below))); console.log(show(Reflect.construct(A, [], Stranger)));
function Point() { this.x = 8; }
class OverPoint extends Point { #q = 9; y = 10; q() { return this.#q; } }
console.log(show(new OverPoint())); console.log(show(Reflect.construct(Point, [], OverPoint))); console.log(show(Reflect.construct(Point, [], Stranger))); console.log(show(Reflect.construct(Point, [], Below)));
