let work = 0;
for (let i = 0; i < 2; i++) work = (work + i) | 0;
const unseen = (x) => [x][JSON.parse("0")];
console.log("first", module.loaded, typeof unseen(module).exports);
module.exports = undefined;
console.log("then", module.loaded, typeof unseen(module).exports);
