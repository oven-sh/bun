"use strict";
const holder = {};
function read() { return holder.mark; }
let before = 0;
for (let turn = 0; turn < 200; turn++) if (read() === undefined) before++;
Object.defineProperty(holder, "mark", { value: "laid" });
let after = 0;
for (let turn = 0; turn < 200; turn++) if (read() === "laid") after++;
console.log(before, after, Object.keys(holder).length);
