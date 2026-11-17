"use strict";
const D = JSON.parse("[5,6,7]");
function run(D) { return D.map(function (v, i, whole) { return [v, i, whole === D, this.tag]; }, { tag: "t" }); }
let r; for (let t = 0; t < 40; t++) r = run(D);
console.log(JSON.stringify(r));
