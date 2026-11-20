// The field of a copy of such a record or of an instance is stored into, also where it was deleted.
declare const process: { readonly argv: readonly string[] };
export {};
class Mark { weight: number; constructor(weight: number) { this.weight = weight; } }
function makeRecord(weight: number) { return { weight }; }
function mayFreeze(holder: any): void { if (process.argv.length > 90) Object.freeze(holder); }
function store(holder: any, value: unknown): string {
  mayFreeze(holder);
  try { holder.weight = value; } catch { return "refused"; }
  return String(holder.weight);
}
const bare: any = makeRecord(4);
Object.setPrototypeOf(bare, null);
const holders: any[] = [{ ...makeRecord(3) }, new Mark(2)];
for (const holder of holders) console.log(store(holder, undefined), store(holder, 0.5), store(holder, "text"));
for (const holder of holders) delete holder.weight;
for (const holder of holders) console.log(store(holder, 6), Object.keys(holder).join());
