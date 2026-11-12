// The class gets a setter, and then a read-only value, under a key that only the run knows. The stores run and obey them.
declare const process: { readonly argv: readonly string[] };
export {};
class Mark { weight: number; constructor(weight: number) { this.weight = weight; } }
function makeRecord(weight: number) { return { weight }; }
function mayFreeze(holder: any): void { if (process.argv.length > 90) Object.freeze(holder); }
const heard: unknown[] = [];
function addName(holder: any): string {
  mayFreeze(holder);
  try { holder.note = 5; } catch { return "refused"; }
  return Object.keys(holder).join();
}
function lay(holder: any, name: string, descriptor: PropertyDescriptor): void { Object.defineProperty(Object.getPrototypeOf(holder), name, descriptor); }
const name = process.argv.length > 90 ? "other" : "note";
const bare: any = makeRecord(4);
Object.setPrototypeOf(bare, null);
const makeHolders = (): any[] => [makeRecord(3), new Mark(2), { ...makeRecord(1) }];
for (const holder of makeHolders()) console.log(addName(holder));
lay(new Mark(0), name, { set(value) { heard.push(value); }, configurable: true });
for (const holder of makeHolders()) console.log(addName(holder), heard.join());
lay(new Mark(0), name, { value: "fixed", writable: false, configurable: true });
for (const holder of makeHolders()) console.log(addName(holder), heard.join());
console.log(addName(bare));
