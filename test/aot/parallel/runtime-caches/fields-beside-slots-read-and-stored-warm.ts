// Fields that most objects never fill, so the last of them lie outside the cell. Some objects get such a field in another form or with a value of another type than the constructor's code shows:
// the property then lies beside the fields. Warm reads, stores and questions by name and by key have to follow it there and back.
const box: any[] = JSON.parse("[null]");
function hide(x: any): any { box[0] = x; return box[0]; }
const one: number = hide(1);

interface NodeLike { nodeKind: number; n0?: NodeLike; n1?: NodeLike; n2?: NodeLike; n3?: NodeLike; n4?: NodeLike; n5?: NodeLike; n6?: NodeLike; n7?: NodeLike; n8?: NodeLike; n9?: NodeLike; n10?: NodeLike; n11?: NodeLike; n12?: NodeLike; n13?: NodeLike; n14?: NodeLike; n15?: NodeLike; n16?: NodeLike; n17?: NodeLike; n18?: NodeLike; n19?: NodeLike; n20?: NodeLike; n21?: NodeLike; n22?: NodeLike; n23?: NodeLike; n24?: NodeLike; n25?: NodeLike; n26?: NodeLike; n27?: NodeLike; n28?: NodeLike; n29?: NodeLike; n30?: NodeLike; n31?: NodeLike; n32?: NodeLike; n33?: NodeLike; n34?: NodeLike; n35?: NodeLike; n36?: NodeLike; n37?: NodeLike; n38?: NodeLike; n39?: NodeLike; }
function NodeObject(this: NodeLike, kind: number) { this.nodeKind = kind; this.n0 = undefined; this.n1 = undefined; this.n2 = undefined; this.n3 = undefined; this.n4 = undefined; this.n5 = undefined; this.n6 = undefined; this.n7 = undefined; this.n8 = undefined; this.n9 = undefined; this.n10 = undefined; this.n11 = undefined; this.n12 = undefined; this.n13 = undefined; this.n14 = undefined; this.n15 = undefined; this.n16 = undefined; this.n17 = undefined; this.n18 = undefined; this.n19 = undefined; this.n20 = undefined; this.n21 = undefined; this.n22 = undefined; this.n23 = undefined; this.n24 = undefined; this.n25 = undefined; this.n26 = undefined; this.n27 = undefined; this.n28 = undefined; this.n29 = undefined; this.n30 = undefined; this.n31 = undefined; this.n32 = undefined; this.n33 = undefined; this.n34 = undefined; this.n35 = undefined; this.n36 = undefined; this.n37 = undefined; this.n38 = undefined; this.n39 = undefined; }
const NodeConstructor: new (kind: number) => NodeLike = NodeObject as any;
function makeNodes(count: number): NodeLike[] { const list: NodeLike[] = []; for (let r = 0; r < one; r++) for (let q = 0; q < one; q++) for (let i = 0; i < count; i++) list.push(new NodeConstructor(i)); return list; }
function linkNode(o: NodeLike, v: NodeLike) { o.n0 = v; o.n1 = v; o.n2 = v; o.n3 = v; o.n4 = v; o.n5 = v; o.n6 = v; o.n7 = v; o.n8 = v; o.n9 = v; o.n10 = v; o.n11 = v; o.n12 = v; o.n13 = v; o.n14 = v; o.n15 = v; o.n16 = v; o.n17 = v; o.n18 = v; o.n19 = v; o.n20 = v; o.n21 = v; o.n22 = v; o.n23 = v; o.n24 = v; o.n25 = v; o.n26 = v; o.n27 = v; o.n28 = v; o.n29 = v; o.n30 = v; o.n31 = v; o.n32 = v; o.n33 = v; o.n34 = v; o.n35 = v; o.n36 = v; o.n37 = v; o.n38 = v; o.n39 = v; }
function countNode(o: NodeLike): number { let k = 0; if (o.n0) k++; if (o.n1) k++; if (o.n2) k++; if (o.n3) k++; if (o.n4) k++; if (o.n5) k++; if (o.n6) k++; if (o.n7) k++; if (o.n8) k++; if (o.n9) k++; if (o.n10) k++; if (o.n11) k++; if (o.n12) k++; if (o.n13) k++; if (o.n14) k++; if (o.n15) k++; if (o.n16) k++; if (o.n17) k++; if (o.n18) k++; if (o.n19) k++; if (o.n20) k++; if (o.n21) k++; if (o.n22) k++; if (o.n23) k++; if (o.n24) k++; if (o.n25) k++; if (o.n26) k++; if (o.n27) k++; if (o.n28) k++; if (o.n29) k++; if (o.n30) k++; if (o.n31) k++; if (o.n32) k++; if (o.n33) k++; if (o.n34) k++; if (o.n35) k++; if (o.n36) k++; if (o.n37) k++; if (o.n38) k++; if (o.n39) k++; return k; }
const readers: ((o: any) => any)[] = [(o: any) => o.n0, (o: any) => o.n1, (o: any) => o.n2, (o: any) => o.n3, (o: any) => o.n4, (o: any) => o.n5, (o: any) => o.n6, (o: any) => o.n7, (o: any) => o.n8, (o: any) => o.n9, (o: any) => o.n10, (o: any) => o.n11, (o: any) => o.n12, (o: any) => o.n13, (o: any) => o.n14, (o: any) => o.n15, (o: any) => o.n16, (o: any) => o.n17, (o: any) => o.n18, (o: any) => o.n19, (o: any) => o.n20, (o: any) => o.n21, (o: any) => o.n22, (o: any) => o.n23, (o: any) => o.n24, (o: any) => o.n25, (o: any) => o.n26, (o: any) => o.n27, (o: any) => o.n28, (o: any) => o.n29, (o: any) => o.n30, (o: any) => o.n31, (o: any) => o.n32, (o: any) => o.n33, (o: any) => o.n34, (o: any) => o.n35, (o: any) => o.n36, (o: any) => o.n37, (o: any) => o.n38, (o: any) => o.n39];
const typedReaders: ((o: NodeLike) => any)[] = [(o: NodeLike) => o.n0, (o: NodeLike) => o.n1, (o: NodeLike) => o.n2, (o: NodeLike) => o.n3, (o: NodeLike) => o.n4, (o: NodeLike) => o.n5, (o: NodeLike) => o.n6, (o: NodeLike) => o.n7, (o: NodeLike) => o.n8, (o: NodeLike) => o.n9, (o: NodeLike) => o.n10, (o: NodeLike) => o.n11, (o: NodeLike) => o.n12, (o: NodeLike) => o.n13, (o: NodeLike) => o.n14, (o: NodeLike) => o.n15, (o: NodeLike) => o.n16, (o: NodeLike) => o.n17, (o: NodeLike) => o.n18, (o: NodeLike) => o.n19, (o: NodeLike) => o.n20, (o: NodeLike) => o.n21, (o: NodeLike) => o.n22, (o: NodeLike) => o.n23, (o: NodeLike) => o.n24, (o: NodeLike) => o.n25, (o: NodeLike) => o.n26, (o: NodeLike) => o.n27, (o: NodeLike) => o.n28, (o: NodeLike) => o.n29, (o: NodeLike) => o.n30, (o: NodeLike) => o.n31, (o: NodeLike) => o.n32, (o: NodeLike) => o.n33, (o: NodeLike) => o.n34, (o: NodeLike) => o.n35, (o: NodeLike) => o.n36, (o: NodeLike) => o.n37, (o: NodeLike) => o.n38, (o: NodeLike) => o.n39];
const writers: ((o: any, v: any) => void)[] = [(o: any, v: any) => { o.n0 = v; }, (o: any, v: any) => { o.n1 = v; }, (o: any, v: any) => { o.n2 = v; }, (o: any, v: any) => { o.n3 = v; }, (o: any, v: any) => { o.n4 = v; }, (o: any, v: any) => { o.n5 = v; }, (o: any, v: any) => { o.n6 = v; }, (o: any, v: any) => { o.n7 = v; }, (o: any, v: any) => { o.n8 = v; }, (o: any, v: any) => { o.n9 = v; }, (o: any, v: any) => { o.n10 = v; }, (o: any, v: any) => { o.n11 = v; }, (o: any, v: any) => { o.n12 = v; }, (o: any, v: any) => { o.n13 = v; }, (o: any, v: any) => { o.n14 = v; }, (o: any, v: any) => { o.n15 = v; }, (o: any, v: any) => { o.n16 = v; }, (o: any, v: any) => { o.n17 = v; }, (o: any, v: any) => { o.n18 = v; }, (o: any, v: any) => { o.n19 = v; }, (o: any, v: any) => { o.n20 = v; }, (o: any, v: any) => { o.n21 = v; }, (o: any, v: any) => { o.n22 = v; }, (o: any, v: any) => { o.n23 = v; }, (o: any, v: any) => { o.n24 = v; }, (o: any, v: any) => { o.n25 = v; }, (o: any, v: any) => { o.n26 = v; }, (o: any, v: any) => { o.n27 = v; }, (o: any, v: any) => { o.n28 = v; }, (o: any, v: any) => { o.n29 = v; }, (o: any, v: any) => { o.n30 = v; }, (o: any, v: any) => { o.n31 = v; }, (o: any, v: any) => { o.n32 = v; }, (o: any, v: any) => { o.n33 = v; }, (o: any, v: any) => { o.n34 = v; }, (o: any, v: any) => { o.n35 = v; }, (o: any, v: any) => { o.n36 = v; }, (o: any, v: any) => { o.n37 = v; }, (o: any, v: any) => { o.n38 = v; }, (o: any, v: any) => { o.n39 = v; }];
const askers: ((o: any) => boolean)[] = [(o: any) => "n0" in o, (o: any) => "n1" in o, (o: any) => "n2" in o, (o: any) => "n3" in o, (o: any) => "n4" in o, (o: any) => "n5" in o, (o: any) => "n6" in o, (o: any) => "n7" in o, (o: any) => "n8" in o, (o: any) => "n9" in o, (o: any) => "n10" in o, (o: any) => "n11" in o, (o: any) => "n12" in o, (o: any) => "n13" in o, (o: any) => "n14" in o, (o: any) => "n15" in o, (o: any) => "n16" in o, (o: any) => "n17" in o, (o: any) => "n18" in o, (o: any) => "n19" in o, (o: any) => "n20" in o, (o: any) => "n21" in o, (o: any) => "n22" in o, (o: any) => "n23" in o, (o: any) => "n24" in o, (o: any) => "n25" in o, (o: any) => "n26" in o, (o: any) => "n27" in o, (o: any) => "n28" in o, (o: any) => "n29" in o, (o: any) => "n30" in o, (o: any) => "n31" in o, (o: any) => "n32" in o, (o: any) => "n33" in o, (o: any) => "n34" in o, (o: any) => "n35" in o, (o: any) => "n36" in o, (o: any) => "n37" in o, (o: any) => "n38" in o, (o: any) => "n39" in o];
const first = makeNodes(2);
linkNode(first[0], first[1]);
const lines: string[] = ["linked " + countNode(first[0]) + " " + countNode(first[1])];

function show(v: any): string { return typeof v === "object" && v !== null ? "node " + v.nodeKind : String(v); }
function describe(o: any, key: string): string {
  const d = Object.getOwnPropertyDescriptor(o, key);
  if (!d) return "none";
  return ("value" in d ? show(d.value) : "accessor") + (d.writable ? " w" : "") + (d.enumerable ? " e" : "") + (d.configurable ? " c" : "");
}
const states = ["fresh", "filled", "hidden", "other", "getter", "pair", "fixed", "deleted", "sealed", "sealed other", "frozen", "frozen other", "closed other"];
let stored: any[] = [];
function prepare(o: any, key: string, state: string) {
  switch (state) {
    case "filled": o[key] = o; break;
    case "hidden": Object.defineProperty(o, key, { value: 7, writable: true, configurable: true, enumerable: false }); break;
    case "other": o[key] = 7; break;
    case "getter": Object.defineProperty(o, key, { get() { return 11; }, enumerable: true, configurable: true }); break;
    case "pair": Object.defineProperty(o, key, { get() { return 13; }, set(v) { stored.push(show(v)); }, enumerable: false, configurable: true }); break;
    case "fixed": Object.defineProperty(o, key, { value: 9, writable: false, enumerable: true, configurable: true }); break;
    case "deleted": delete o[key]; break;
    case "sealed": Object.seal(o); break;
    case "sealed other": o[key] = 7; Object.seal(o); break;
    case "frozen": Object.freeze(o); break;
    case "frozen other": o[key] = 7; Object.freeze(o); break;
    case "closed other": o[key] = 7; Object.preventExtensions(o); break;
  }
}
function readKey(o: any, k: any): any { return o[k]; }
function storeKey(o: any, k: any, v: any) { o[k] = v; }
function look(title: string, typed: NodeLike[], field: number) {
  const list: any[] = hide(typed), key: string = hide("n" + field);
  const reader = readers[hide(field)], typedReader = typedReaders[hide(field)], asker = askers[hide(field)];
  let text = "";
  for (let turn = 0; turn < 40; turn++) {
    const parts: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      parts.push([show(reader(o)), show(typedReader(typed[i])), show(readKey(o, key)), asker(o), Object.hasOwn(o, key)].join(" "));
    }
    const now = parts.join(" | ");
    if (turn && now !== text) lines.push(title + ": CHANGED AT TURN " + turn);
    text = now;
  }
  lines.push(title + ": " + text);
  lines.push(title + ": " + list.map(o => describe(o, key) + " #" + Object.keys(o).indexOf(key) + "/" + Object.keys(o).length).join(" | "));
}
function storeAll(title: string, typed: NodeLike[], field: number, byKey: boolean, valueFor: (o: any, turn: number) => any) {
  const list: any[] = hide(typed), key: string = hide("n" + field), writer = writers[hide(field)];
  const refused: string[] = [];
  stored = [];
  for (let turn = 0; turn < 40; turn++) {
    for (let i = 0; i < list.length; i++) {
      try { if (byKey) storeKey(list[i], key, valueFor(list[i], turn)); else writer(list[i], valueFor(list[i], turn)); }
      catch (e: any) { if (turn === 39) refused.push(states[i] + " " + e.constructor.name); }
    }
  }
  lines.push(title + ": refused " + refused.join(", ") + "; setters ran " + stored.length + " " + stored.slice(-1).join());
}
for (const field of [39, 0, 20]) {
  for (const byKey of [false, true]) {
    const name = "n" + field + (byKey ? " by key" : " by name");
    const typed = makeNodes(states.length);
    for (let i = 0; i < typed.length; i++) prepare(hide(typed[i]), hide("n" + field), states[i]);
    look(name + " prepared", typed, field);
    storeAll(name + " numbers", typed, field, byKey, (o, turn) => turn);
    look(name + " after numbers", typed, field);
    Bun.gc(true);
    look(name + " after a collection", typed, field);
    storeAll(name + " nodes", typed, field, byKey, o => o);
    look(name + " after nodes", typed, field);
    storeAll(name + " undefined", typed, field, byKey, () => undefined);
    look(name + " after undefined", typed, field);
    for (let i = 0; i < typed.length; i++) {
      try { Object.defineProperty(hide(typed[i]), hide("n" + field), { value: typed[0], writable: true, enumerable: true, configurable: true }); } catch (e: any) { lines.push(name + " " + states[i] + " is not redefined: " + e.constructor.name); }
    }
    look(name + " plain again", typed, field);
    storeAll(name + " numbers again", typed, field, byKey, (o, turn) => -turn);
    look(name + " after numbers again", typed, field);
    for (let i = 0; i < typed.length; i++) { try { delete hide(typed[i])[hide("n" + field)]; } catch (e: any) { lines.push(name + " " + states[i] + " is not deleted: " + e.constructor.name); } }
    look(name + " deleted", typed, field);
    Object.defineProperty(NodeObject.prototype, "n" + field, { get() { return 17; }, set(v) { stored.push("above " + show(v)); }, configurable: true });
    look(name + " below an accessor", typed, field);
    storeAll(name + " stores below an accessor", typed, field, byKey, (o, turn) => turn);
    look(name + " after stores below an accessor", typed, field);
    delete (NodeObject.prototype as any)["n" + field];
    storeAll(name + " stores when it is gone", typed, field, byKey, (o, turn) => turn & 1 ? o : turn);
    look(name + " at the end", typed, field);
  }
}
console.log(lines.join("\n"));
