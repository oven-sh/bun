"use strict";
const lib = { base: 2 };
Object.defineProperty(lib, "twice", { get() { return this.base * 2; } });
const heir = Object.create(lib);
heir.base = 10;
function store() { try { heir.twice = 5; return "stored"; } catch (error) { return error.constructor.name; } }
function read(turns) { let s = 0; for (let i = 0; i < turns; i++) s += heir.twice | 0; return s; }
console.log(read(3), store(), read(3), Object.keys(heir).join());
