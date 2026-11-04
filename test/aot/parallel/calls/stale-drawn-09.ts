var v1: string[] = [];
class v2 { #f: () => void; constructor(f: () => void) { this.#f = f; } set(): void { this.#f(); } }
var v3: any = { box: (write: any): any => ({ set() { write(7); } }), unread: (write: any): any => ({ set() { write("other"); } }) };
function v4(): void {
  const name: any = ["b", "ox"].join(""), first: any = 0;
  var state: any = first;
  v3[name]?.((v: any) => { state = v; })?.set();
  v1.push(typeof state + String(state === first));
}
v4();
function v0(): string {
  { const $t: string = v1.join(","); console.log("r0" + " " + ($t.includes("=>") || $t.includes(") {") || $t.includes("class ") ? "~body" : $t.replaceAll("Error", "Err.").replaceAll("Invalid", "Inv.").replaceAll(" | ", " |. ").replaceAll("{", "{."))); return $t; }
}
try {
  console.log("p3", typeof (v0()));
} catch (v6) {
  console.log("c4", typeof (v6));
}
console.log("v0", typeof (v0));
console.log("end 0");
