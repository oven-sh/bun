var v1 = [];
class v2 { #f; constructor(f) { this.#f = f; } set() { this.#f(); } }
class v3 { box(write) { return ((write) => ({ set() { write(true); } }))(write); } unread(write) { return ((write) => ({ set() { write("other"); } }))(write); } }
var v4 = new v3();
function v5() {
  const name = ["b", "ox"].join(""), first = false;
  var state = first;
  v4[name]?.((v) => { state = v; })?.set();
  v1.push(JSON.stringify(state) ?? "u");
}
v5();
function main() {
  function v0() {
    { const $t = v1.join(","); console.log("r0" + " " + ($t.includes("=>") || $t.includes(") {") || $t.includes("class ") ? "~body" : $t.replaceAll("Error", "Err.").replaceAll("Invalid", "Inv.").replaceAll(" | ", " |. ").replaceAll("{", "{."))); return $t; }
  }
  for (let v6 = 0; v6 < 3; v6++) {
    let v7; try { v7 = v0(); } catch ($e) { console.log("x2", typeof ($e)); }
    console.log("p3", typeof (v7));
  }
  console.log("v0", typeof (v0));
}
try { main(); } catch ($e) { console.log("main", typeof ($e)); }
console.log("end 0");
