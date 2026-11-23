interface Row { kind: "plain" | "kept"; id: number; sum: number; fee: number }
abstract class Held { protected sum: number; constructor(readonly id: number, sum: number) { this.sum = sum; } abstract step(): number; get worth(): number { return this.sum; } }
class Plain extends Held { #fee: number; note = "p"; constructor(row: Row) { super(row.id, row.sum); this.#fee = row.fee; } step(): number { this.sum -= this.#fee; return this.#fee; } static is(one: unknown): boolean { return typeof one === "object" && one !== null && #fee in one; } }
class Kept extends Held { #rate: number; constructor(row: Row) { super(row.id, row.sum); this.#rate = row.fee / 100; } step(): number { const more = Math.round(this.sum * this.#rate); this.sum += more; return -more; } }
class Alone { left: number; constructor(row: Row) { this.left = row.sum; } }
const rows: Row[] = JSON.parse('[{"kind":"plain","id":1,"sum":4900,"fee":100},{"kind":"kept","id":2,"sum":72583,"fee":7}]');
function open(row: Row): Held { return row.kind === "plain" ? new Plain(row) : new Kept(row); }
const said: string[] = [];
for (let turn = 0; turn < 12; turn++) {
  const all = rows.map(open);
  let flow = 0;
  for (const one of all) flow += one.step();
  const strange = turn < 5 ? new Plain(rows[0]!) : Reflect.construct(Plain, [rows[0]!], turn % 2 ? Kept : Alone) as Plain;
  said.push(flow + ":" + all.map(one => one.worth).join() + ":" + Plain.is(strange) + (strange instanceof Plain) + (strange instanceof Kept) + Object.keys(strange).join("") + new Alone(rows[1]!).left);
}
console.log(said.join(" "));
