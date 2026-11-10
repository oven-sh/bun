"use strict";
class Count { constructor(limit) { this.limit = limit; this.at = 0; this.next = () => ({ done: this.at >= 2, value: 100 + this.at++ }); } next() { return this.at < this.limit ? { done: false, value: this.at++ } : { done: true, value: undefined }; } [Symbol.iterator]() { return this; } }
class Bound { constructor(limit) { this.limit = limit; this.at = 0; this.next = this.next.bind({ limit: 2, at: 0 }); } next() { return this.at < this.limit ? { done: false, value: this.at++ } : { done: true, value: undefined }; } [Symbol.iterator]() { return this; } }
function sum(Class, limit) { let s = 0; for (const v of new Class(limit)) s += v + 1; return s; }
let all = 0; for (let t = 0; t < +(process.argv[2] ?? 50); t++) all += sum(Count, 5) + sum(Bound, 5);
console.log(all, [...new Count(9)].join(), [...new Bound(9)].join());
