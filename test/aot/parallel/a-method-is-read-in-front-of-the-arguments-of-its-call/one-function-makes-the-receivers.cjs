"use strict";
class Plate { constructor(n) { this.side = n; } area(n) { return this.side * 1000 + n; } }
class Board { constructor(n) { this.wide = n; } area(n) { return this.wide * 1000 + n; } }
class Ghost { constructor(n) { this.mist = n; } }
const make = k => n => k * 100 + n;
const ghost = new Ghost(4);
ghost.area = make(10);
let count = 0;
function swap() { count++; ghost.area = make(10 + count); return 1; }
function probe(figure) { let work = 0; for (let i = 0; i < 3; i++) work = (work + i) | 0; const got = figure.area(swap()); return got + work; }
console.log(probe(new Plate(2)), probe(new Board(3)), probe(ghost), count, process.argv[2] ?? "");
