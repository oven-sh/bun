"use strict";
function make(i) { return { kept: i }; }
function mark(object) { Object.defineProperty(object, "tag", { value: 1 }); }
const all = []; for (let i = 0; i < 20; i++) all.push(make(i));
Object.preventExtensions(all[5]); Object.freeze(all[6]);
let failed = "";
for (let i = 0; i < all.length; i++) { try { mark(all[i]); } catch (error) { failed += i + ":" + error.name + ","; } }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + (list[i].tag === undefined ? 100 : list[i].tag); return s; }
console.log(failed, sum(all), "tag" in all[5], "tag" in all[4], Object.getOwnPropertyNames(all[5]).join(), Object.getOwnPropertyNames(all[4]).join());
