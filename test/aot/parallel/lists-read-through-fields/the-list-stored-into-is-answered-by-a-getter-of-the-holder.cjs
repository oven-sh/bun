"use strict";
let asked = 0;
const lists = JSON.parse(process.argv[2] ?? "[[1,2,3],[4,5,6],[7,8,9]]");
class Store { get rows() { return lists[asked++ % lists.length]; } flip() { for (let place = 0; place < this.rows.length; place++) this.rows[place] = 32 - this.rows[place]; return asked; } }
const plain = { get rows() { return lists[asked++ % lists.length]; } };
function flip(holder) { for (let place = 0; place < holder.rows.length; place++) holder.rows[place] = 32 - holder.rows[place]; return asked; }
console.log("SAID", new Store().flip(), JSON.stringify(lists));
console.log("SAID", flip(plain), JSON.stringify(lists));
