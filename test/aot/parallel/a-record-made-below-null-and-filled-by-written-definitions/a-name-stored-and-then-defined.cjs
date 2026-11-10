"use strict";
function copyOf(given) { const made = Object.create(null); made.id = given.id; Object.defineProperty(made, "id", { value: 5 }); return made; }
const copies = []; for (let i = 0; i < 40; i++) copies.push(copyOf({ id: i }));
let s = 0; for (let i = 0; i < copies.length; i++) s += copies[i].id;
console.log(s, Object.keys(copies[3]).join(), JSON.stringify(Object.getOwnPropertyDescriptor(copies[3], "id")), process.argv[2]);
