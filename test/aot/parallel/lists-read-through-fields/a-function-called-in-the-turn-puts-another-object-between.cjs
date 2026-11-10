"use strict";
const box = { page: { rows: JSON.parse(process.argv[2] ?? "[1,2,3,4]") } };
const pages = [{ rows: JSON.parse(process.argv[3] ?? "[5,6,7]") }, { rows: [8, 9, 10, 11, 12] }];
const hooks = { swap(place) { if (place < pages.length) box.page = pages[place]; return place; } };
function sum(name) { let total = 0; for (let place = 0; place < box.page.rows.length; place++) { total = total + box.page.rows[place]; hooks[name](place); } return total; }
console.log("SAID", sum(process.argv[4] ?? "swap"), box.page.rows.join());
