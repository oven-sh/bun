// One record of the program gets null above it. A field is read off a copy of such a record or an instance of a class.
export {};
class Mark { weight: boolean = true; }
function makeRecord(weight: number) { return { weight }; }
function read(holder: any): string { return String(holder.weight); }
const bare: any = makeRecord(-3);
Object.setPrototypeOf(bare, null);
const holders: any[] = [{ ...makeRecord(0) }, new Mark()];
for (const holder of holders) console.log(read(holder));
