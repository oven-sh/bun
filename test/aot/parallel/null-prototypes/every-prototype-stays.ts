// No prototype changes.
export {};
class Mark { weight: boolean = true; }
function makeRecord(weight: number) { return { weight }; }
function read(holder: any): string { return String(holder.weight) + String(holder.weight); }
const lost: any = makeRecord(-3);
delete lost.weight;
const holders: any[] = [{ ...makeRecord(0) }, new Mark(), lost, { ...lost }];
for (const holder of holders) console.log(read(holder));
