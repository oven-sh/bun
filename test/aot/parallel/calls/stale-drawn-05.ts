var v1: string[] = [];
class v2 { #f: () => void; constructor(f: () => void) { this.#f = f; } set(): void { this.#f(); } }
class v3 { box(write: any): any { return ((write: any): any => { const later = () => write(true); return { set: later }; })(write); } unread(write: any): any { return ((write: any): any => ({ set() { write("other"); } }))(write); } }
var v4: any = new v3();
function v5(): void {
  const name: any = String(JSON.parse("\"box\"")), first: any = false;
  var state: any = first;
  v4[name]((v: any) => { state = v; }).set();
  if (state === first) v1.push("stale"); else v1.push("fresh");
}
v5();
function main() {
  function v0(): string {
    { const $t: string = v1.join(","); console.log("r0" + " " + ($t.includes("=>") || $t.includes(") {") || $t.includes("class ") ? "~body" : $t.replaceAll("Error", "Err.").replaceAll("Invalid", "Inv.").replaceAll(" | ", " |. ").replaceAll("{", "{."))); return $t; }
  }
  try {
    const v6: string = v0();
    console.log("p3", typeof (v6));
  } catch (v7) {
    console.log("c4", typeof (v7));
  }
  console.log("v0", typeof (v0));
}
try { main(); } catch ($e) { console.log("main", typeof ($e)); }
console.log("end 0");
