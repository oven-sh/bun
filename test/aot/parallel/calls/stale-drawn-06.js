var v1 = [];
class v2 { #f; constructor(f) { this.#f = f; } set() { this.#f(); } }
var v3 = { box: (write) => { const later = () => write(7); return { set: later }; }, unread: (write) => ({ set() { write("other"); } }) };
const name = `${JSON.parse("\"b\"")}ox`, first = 0;
let state = first;
v3[name]((v) => { state = v; }).set();
v1.push(JSON.stringify(state) ?? "u");
function v0() {
  { const $t = v1.join(","); console.log("r0" + " " + ($t.includes("=>") || $t.includes(") {") || $t.includes("class ") ? "~body" : $t.replaceAll("Error", "Err.").replaceAll("Invalid", "Inv.").replaceAll(" | ", " |. ").replaceAll("{", "{."))); return $t; }
}
for (let v4 = 0; v4 < 1; v4++) {
  let v5; try { v5 = v0(); } catch ($e) { console.log("x2", typeof ($e)); }
  console.log("p3", typeof (v5));
}
console.log("v0", typeof (v0));
console.log("end 0");
