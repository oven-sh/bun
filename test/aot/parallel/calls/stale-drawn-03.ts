var v1: string[] = [];
class v2 { #f: () => void; constructor(f: () => void) { this.#f = f; } set(): void { this.#f(); } }
class v3 { box(write: any): any { return ((write: any): any => new v2(() => write(true)))(write); } unread(write: any): any { return ((write: any): any => ({ set() { write("other"); } }))(write); } }
var v4: any = new v3();
const name: any = JSON.parse("\"box\""), first: any = false;
var state: any = first;
v4[name]?.((v: any) => { state = v; })?.set();
v1.push(JSON.stringify(state) ?? "u");
function main() {
  function v0(): string {
    { const $t: string = v1.join(","); console.log("r0" + " " + ($t.includes("=>") || $t.includes(") {") || $t.includes("class ") ? "~body" : $t.replaceAll("Error", "Err.").replaceAll("Invalid", "Inv.").replaceAll(" | ", " |. ").replaceAll("{", "{."))); return $t; }
  }
  try {
    console.log("p3", typeof (v0()));
  } catch (v6) {
    console.log("c4", typeof (v6));
  }
  console.log("v0", typeof (v0));
}
try { main(); } catch ($e) { console.log("main", typeof ($e)); }
console.log("end 0");
