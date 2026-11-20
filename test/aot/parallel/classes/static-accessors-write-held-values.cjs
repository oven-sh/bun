"use strict";
// Callers hold fields, elements and lengths across functions that read, call and construct through classes. What a class runs may write them.
const held = { a: 1, b: 2.5 }, list = [1, 2, 3], view = new Int32Array(4);
let hits = 0;
function spoil() {
    hits++;
    held.a = held.a + 1 | 0;
    list[1] = hits;
    view[2] = -hits;
    if (hits === 5)
        list.push(hits);
    return hits;
}

class Vector {
    static count = 0;
    static unit = 1;
    constructor(x, y) { this.x = x; this.y = y; Vector.count++; }
    static make(x) { return new Vector(x, 1); }
    static get zero() { return 0; }
    static get next() { return spoil(); }
    static set next(value) { spoil(); view[3] = value; }
    get sum() { return this.x + this.y; }
}
class Point extends Vector {
    constructor(x) { super(x, 2); this.z = held.a; }
    static make(x) { return super.make(x).x + 1; }
}
class Loud extends Vector {
    loud = spoil();
}

const quiet = n => Vector.make(n).x + Vector.zero + Vector.unit + new Vector(n, 3).sum;
const pointed = n => new Point(n).z + Point.make(n);
const reads = () => Vector.next;
const stores = n => { Vector.next = n; };
const loud = n => new Loud(n, 1).loud;
const inherited = () => Point.next;

function around(f, n) {
    const before = held.a * 1000 + list[1] * 100 + list.length * 10 + view[2];
    const got = f(n);
    return [before, got, held.a * 1000 + list[1] * 100 + list.length * 10 + view[2], Vector.count].join();
}
function loop(f, n) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += held.a + list[1] + list.length;
        f(i);
        sum = sum * 3 + view[2] + held.a | 0;
    }
    return sum;
}
for (const f of [quiet, pointed, reads, stores, loud, inherited])
    console.log(around(f, 4), loop(f, 7), around(f, 2.5));

// A class in a scope, held by the functions of the scope alone.
function scope(n) {
    class Counter {
        constructor(start) { this.start = start; }
        static from(start) { return new Counter(start); }
        static get last() { return spoil(); }
    }
    const make = start => Counter.from(start).start;
    const last = () => Counter.last;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += held.a;
        sum += make(i) + held.a;
        sum += last();
        sum += held.a;
    }
    return sum;
}
console.log(scope(5), scope(2), hits);

// A variable that is stored into again holds any class.
let Changing = class { constructor() { this.n = 1; } static get n() { return 1; } };
function changed() {
    const before = held.a;
    const n = new Changing().n + Changing.n;
    return [before, n, held.a].join();
}
console.log(changed());
Changing = class { constructor() { this.n = spoil(); } static get n() { return spoil(); } };
console.log(changed(), changed());

// Descriptors and prototypes change what is found on a class.
class Late { constructor() { this.n = 1; } static get n() { return 1; } static m() { return 1; } }
class Below extends Late { }
function late() {
    const before = held.a * 100 + list[1];
    const n = Late.n + Late.m() + (Late.other | 0) + (Below.other | 0) + new Below().n;
    return [before, n, held.a * 100 + list[1]].join();
}
console.log(late());
Object.defineProperty(Late, "n", { get: spoil });
console.log(late());
Late.m = spoil;
console.log(late());
Object.setPrototypeOf(Late, { get other() { return spoil(); } });
console.log(late());

// A proxy of a class and another new target read `prototype` through a trap.
class Plain { constructor() { this.n = held.a; } }
function plain(C) {
    const before = held.a;
    const n = new C().n;
    return [before, n, held.a].join();
}
const trapped = new Proxy(Plain, { get(target, key) { spoil(); return target[key]; } });
console.log(plain(Plain), plain(trapped), Reflect.construct(Plain, [], trapped).n, plain(Plain), hits);
