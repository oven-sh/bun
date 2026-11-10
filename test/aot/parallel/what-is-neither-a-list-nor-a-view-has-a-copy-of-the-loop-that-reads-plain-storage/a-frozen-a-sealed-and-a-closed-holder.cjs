// STATISTIC: ElementsReadInPlainStorageOfWhatIsNoList >= 1
"use strict";
// The holder is frozen, sealed or closed to new names, before and between the calls; reads answer as before.
const said = [];
function sum(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j]; return s; }
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
for (let round = 0; round < 3; round++) for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) {
    const holder = fresh(); said.push(sum(holder)); close(holder); said.push(sum(holder));
    try { holder[1] = 50; } catch (error) { said.push(error.name); } said.push(sum(holder));
    try { holder.length = 2; } catch (error) { said.push(error.name); } said.push(sum(holder));
}
console.log(said.join(" "));
