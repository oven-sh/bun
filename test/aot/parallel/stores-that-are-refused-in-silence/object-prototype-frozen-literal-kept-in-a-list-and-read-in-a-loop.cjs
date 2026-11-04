Object.freeze(Object.prototype);
function make(i) { const made = {}; made.id = i; made.valueOf = i; return made; }
const all = [];
for (let i = 0; i < 3; i++) all.push(make(i));
let kinds = "";
for (const one of all) kinds += typeof one.valueOf + one.id + " ";
console.log(kinds);
