// STATISTIC: ElementsReadInPlainStorageOfWhatIsNoList >= 1
"use strict";
// The holder is a literal of the file with index keys, an instance of a class with a field or a getter named length, an object made by Object.create over a list, and a list with a name added: each comes veiled, so that the build knows nothing of it.
const said = [];
// What goes through here comes back as it is, and nothing is known of it in the build.
function veil(value) { return JSON.parse("0", () => value); }
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
function sum(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j]; return s; }
class Fielded { constructor() { this.length = 3; this[0] = 1; this[1] = 2; this[2] = 3; } }
class Gotten { constructor() { this[0] = 1; this[1] = 2; this.asked = 0; } get length() { return ++this.asked > 2 ? 1 : 2; } }
for (let round = 0; round < 3; round++) {
    const gotten = new Gotten(); const over = Object.create([7, 8, 9]); const named = [1, 2, 3]; named.extra = 5; const shadow = Object.create([7, 8, 9]); shadow.length = 2; shadow[1] = 80;
    said.push(sum(fresh()), sum(veil({ length: 4, 0: 3, 1: 5, 2: 7, 3: 9 })), String(sum(veil({ 0: 3, 1: 5, length: 3 }))), sum(veil(new Fielded())), sum(veil(gotten)), gotten.asked, sum(veil(over)), sum(veil(named)), sum(veil(shadow)));
}
console.log(said.join(" "));
