var v1 = [];
class v2 { #f; constructor(f) { this.#f = f; } set() { this.#f(); } }
class v3 { box(write) { return ((write) => ({ set() { write(true); } }))(write); } unread(write) { return ((write) => ({ set() { write("other"); } }))(write); } }
var v4 = new v3();
const name = JSON.parse("\"box\""), first = false;
let state = first;
v4[name]((v) => { state = v; }).set();
v1.push(typeof state + String(state === first));
function v0() {
  { const $t = v1.join(","); console.log("r0" + " " + ($t.includes("=>") || $t.includes(") {") || $t.includes("class ") ? "~body" : $t.replaceAll("Error", "Err.").replaceAll("Invalid", "Inv.").replaceAll(" | ", " |. ").replaceAll("{", "{."))); return $t; }
}
for (let v5 = 0; v5 < 3; v5++) {
  let v6; try { v6 = v0(); } catch ($e) { console.log("x2", typeof ($e)); }
  console.log("p3", typeof (v6));
}
console.log("v0", typeof (v0));
console.log("end 0");
