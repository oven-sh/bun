// The instance loses its field, and its class gets the name under a key that only the run knows. The read finds it there.
declare const process: { readonly argv: readonly string[] };
export {};
class Mark { weight: boolean = true; }
function makeRecord(weight: number) { return { weight }; }
function read(holder: any): string { return String(holder.weight) + String(holder.weight); }
function lay(holder: any, name: string, value: unknown): void { Object.getPrototypeOf(holder)[name] = value; }
const bare: any = makeRecord(-3);
Object.setPrototypeOf(bare, null);
const name = process.argv.length > 90 ? "other" : "weight";
const lost: any = new Mark();
const copy: any = { ...makeRecord(0) };
const holders: any[] = [copy, lost, new Mark()];
for (const holder of holders) console.log(read(holder));
delete lost.weight;
delete copy.weight;
for (const holder of holders) console.log(read(holder));
lay(lost, name, 70);
for (const holder of holders) console.log(read(holder));
