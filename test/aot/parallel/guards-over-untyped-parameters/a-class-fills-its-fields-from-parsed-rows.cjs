"use strict";
const rows = JSON.parse('[{"id":1,"name":"a","on":true},{"id":2,"name":"b","on":false},{"id":"3","on":null}]');
class User { constructor(row) { this.id = row.id; this.name = row.name; this.on = row.on; } }
const make = row => new User(row);
function all() { const out = []; for (let i = 0; i < rows.length; i++) { const u = make(rows[i]); out.push(u.id, u.name, u.on); } return out.join(); }
for (let t = 0; t < 300; t++) all();
console.log(all());
const copy = make(make(rows[1]));
console.log(copy.id, copy.name, copy.on, copy instanceof User);
try { make(null); } catch (e) { console.log(e instanceof TypeError, e.message); }
