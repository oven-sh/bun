"use strict";
function make(isMarked) { const made = {}; if (isMarked) Object.defineProperty(made, "mark", { value: 3, enumerable: true }); return made; }
function read(holder) { let sum = 0; for (let i = 0; i < 20; i++) sum = (sum + (holder.mark === undefined ? 100 : holder.mark)) | 0; return sum; }
let said = 0, own = 0;
for (let turn = 0; turn < 400; turn++) { const made = make(turn % 3 === 0); said = (said + read(made)) % 1000003; if (Object.hasOwn(made, "mark")) own++; if ("mark" in made) own += 1000; }
console.log(said, own);
