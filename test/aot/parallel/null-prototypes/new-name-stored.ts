// One record of the program gets null above it, and objects may be frozen. A name is added to such a record or to an instance of a class.
declare const process: { readonly argv: readonly string[] };
export {};
class Mark { weight: number; constructor(weight: number) { this.weight = weight; } }
function makeRecord(weight: number) { return { weight }; }
function mayFreeze(holder: any): void { if (process.argv.length > 90) Object.freeze(holder); }
function addName(holder: any): string {
  mayFreeze(holder);
  holder.note = undefined;
  return Object.keys(holder).join();
}
const bare: any = makeRecord(4);
Object.setPrototypeOf(bare, null);
const holders: any[] = [makeRecord(3), bare, new Mark(2)];
for (const holder of holders) console.log(addName(holder));
