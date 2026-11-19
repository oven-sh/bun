// What is above the record has the field: the record loses its own, and the read goes on above.
export {};
class Mark { weight: boolean = true; }
function makeRecord(weight: number) { return { weight }; }
function read(holder: any): string { return String(holder.weight) + String(holder.weight); }
const below: any = makeRecord(-3);
Object.setPrototypeOf(below, { weight: 8 });
const holders: any[] = [{ ...makeRecord(0) }, new Mark(), below];
for (const holder of holders) console.log(read(holder));
delete below.weight;
for (const holder of holders) console.log(read(holder));
Object.setPrototypeOf(below, null);
for (const holder of holders) console.log(read(holder));
