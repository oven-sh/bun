"use strict";
function copyOf(given) { const made = Object.create(null); Object.assign(made, given); Object.defineProperty(made, "id", { value: 5 }); return made; }
const givens = []; for (let i = 0; i < 40; i++) givens.push({ id: i, name: "n" + i });
const copies = []; for (const given of givens) copies.push(copyOf(given));
let s = 0; for (let i = 0; i < copies.length; i++) s += copies[i].id + copies[i].name.length;
console.log(s, copies[3].id, givens[3].id, Object.keys(copies[3]).join(), JSON.stringify(Object.getOwnPropertyDescriptor(copies[3], "id")), process.argv[2]);
