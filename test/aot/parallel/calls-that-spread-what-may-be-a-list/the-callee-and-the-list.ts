// The callee changes the list that was spread, keeps its arguments, is a method, stands in tail position, throws under a try, and takes a list that is too long for the stack.
// STATISTIC: CallsWalkedApartFromSpreadsOfWhatIsNoList >= 3
const kept: any[] = [];
function changes(a: any, b: any) { shared.length = 0; shared.push(b, a); return String(a) + "," + String(b); }
const shared: any[] = [1, 2];
const holder = { tag: "h", m(a: any, b: any) { return this.tag + String(a) + String(b); } };
function tail(xs: any) { return two(...(xs as [any, any])); }
function two(a: any, b: any) { return String(a) + "," + String(b); }
function throws(a: any, b: any): string { if (a === 3) throw new Error("at " + b); return String(a); }
function keeps(...all: any[]) { kept.push(all); return all.length; }
const lists: any[] = JSON.parse("[[1,2],[3,4]]");
const lines: string[] = [];
for (let i = 0; i < 8; i++) {
  const xs: any = lists[i & 1];
  let caught = "";
  try { caught = throws(...(xs as [any, any])); } catch (e: any) { caught = e.message; }
  lines.push([i, changes(...(shared as [any, any])), shared.join(), holder.m(...(xs as [any, any])), tail(xs), caught, keeps(...xs), kept[kept.length - 1] === xs, two(...(two(...(xs as [any, any])).split(",") as [any, any]))].join(" "));
}
const long: any = new Array(3000000).fill(1);
let said = "";
for (let i = 0; i < 2; i++) { try { said += two(...(long as [any, any])) + " "; } catch (e: any) { said += e.constructor.name + " "; } }
console.log(lines.join("\n"));
console.log(said);
