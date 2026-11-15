"use strict";
const said = [];
function read(o) { return KEY === undefined ? "early" : o[KEY]; }
function readLater(o) { return LATER === undefined ? "early" : o[LATER]; }
function readDeclared(o) { try { return o[DECLARED]; } catch (error) { return error.constructor.name; } }
said.push(read({ a: 1 }));
var KEY = "a";
said.push(read({ a: 1 }));
[1].forEach(() => said.push(readLater({ b: 2 })));
var LATER = "b";
said.push(readLater({ b: 2 }));
said.push(readDeclared({ c: 3 }));
const DECLARED = "c";
said.push(readDeclared({ c: 3 }));
console.log(said.join());
