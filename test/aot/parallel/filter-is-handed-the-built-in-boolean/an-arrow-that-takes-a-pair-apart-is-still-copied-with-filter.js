// filter() is copied in line where attributes() is copied into the loop of all(), and the arrow with it. The copy hangs on how much the text of the library's filter() weighs: three values more and it was a call.
// STATISTIC: CallsInlined >= 7
"use strict";
const rows = JSON.parse('[{"id":1,"name":"Ada","ok":true},{"id":2,"name":"Grace","ok":false},{"id":3,"name":"Alan","ok":true},{"id":4,"name":"Edsger","ok":true}]');
function attributes(o) { return Object.entries(o).filter(([, v]) => v !== undefined && v !== false).map(([k, v]) => ` ${k}="${v}"`).join(""); }
function all(t) { let s = 0; for (let i = 0; i < 16; i++) { const r = rows[(i + t) & 3]; s = s + (attributes({ id: r.id, class: r.ok ? "on" : undefined, title: r.name })).length; } return s; }
const n = +JSON.parse('"3"'); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + all(t)) % 1000003; console.log(Math.floor(sum));
