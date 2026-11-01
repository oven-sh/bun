var v1 = [];
class v2 { #f; constructor(f) { this.#f = f; } set() { this.#f(); } }
class v3 { box(write) { return ((write) => { const later = () => write(7); return { set: later }; })(write); } unread(write) { return ((write) => ({ set() { write("other"); } }))(write); } }
var v4 = new v3();
const name = "box,unread".split(",")[0], first = 0;
var state = first;
v4[name]?.((v) => { state = v; })?.set();
v1.push(JSON.stringify(state) ?? "u");
function v0() {
  { const $t = v1.join(","); console.log("r0" + " " + ($t.includes("=>") || $t.includes(") {") || $t.includes("class ") ? "~body" : $t.replaceAll("Error", "Err.").replaceAll("Invalid", "Inv.").replaceAll(" | ", " |. ").replaceAll("{", "{."))); return $t; }
}
let v5; try { v5 = v0(); } catch ($e) { console.log("x1", typeof ($e)); }
console.log("p2", typeof (v5));
console.log("v0", typeof (v0));
console.log("v5", typeof (v5));
console.log("end 0");
