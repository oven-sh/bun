"use strict";
class Plate { constructor(n) { this.side = n; } area(n) { return this.side * 1000 + n; } }
class Board { constructor(n) { this.wide = n; } area(n) { return this.wide * 1000 + n; } }
class Ghost { constructor(n) { this.mist = n; } }
const make = k => n => k * 100 + n;
const ghost = new Ghost(4);
ghost.area = make(10);
function probe(figure, k) { let work = 0; for (let i = 0; i < 3; i++) work = (work + i) | 0; const got = figure.area((ghost.area = make(k), 1)); return got + work; }
console.log(probe(new Plate(2), 11), probe(new Board(3), 12), probe(ghost, 13), process.argv[2] ?? "");
