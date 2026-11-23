"use strict";
class Gauge { constructor(limit) { this.limit = limit; this.asked = 0; } get read() { return ++this.asked > this.limit ? undefined : by => by * 2; } set written(value) { this.limit = value; } }
function drive(gauge, turns) { let s = 0; try { for (let i = 0; i < turns; i++) s = (s + gauge.read(i)) | 0; } catch (error) { return s + " " + error.constructor.name; } return s + " none"; }
function store(gauge) { try { return gauge.written(1); } catch (error) { return error.constructor.name; } }
const turns = +(process.argv[2] ?? 50);
console.log(drive(new Gauge(turns >> 1), turns), drive(new Gauge(turns), turns), store(new Gauge(1)));
