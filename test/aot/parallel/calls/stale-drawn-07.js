var v1 = [];
class v2 { #f; constructor(f) { this.#f = f; } set() { this.#f(); } }
class v3 { box(write) { return ((write) => ({ set() { write(7); } }))(write); } unread(write) { return ((write) => ({ set() { write("other"); } }))(write); } }
var v4 = new v3();
function v5() {
  const name = JSON.parse("\"box\""), first = 0;
  let state = first;
  v4[name]((v) => { state = v; }).set();
  v1.push(typeof state + String(state === first));
}
v5();
function main() {
  function v0() {
    { const $t = v1.join(","); console.log("r0" + " " + ($t.includes("=>") || $t.includes(") {") || $t.includes("class ") ? "~body" : $t.replaceAll("Error", "Err.").replaceAll("Invalid", "Inv.").replaceAll(" | ", " |. ").replaceAll("{", "{."))); return $t; }
  }
  let v6; try { v6 = v0(); } catch ($e) { console.log("x1", typeof ($e)); }
  console.log("p2", typeof (v6));
  console.log("v0", typeof (v0));
  console.log("v6", typeof (v6));
}
try { main(); } catch ($e) { console.log("main", typeof ($e)); }
console.log("end 0");
