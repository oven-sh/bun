const reads: any[] = [];
function keep(read: any) { reads.push(read); return reads.length; }
enum Level { Low = keep(() => Level) }
const first = Level;
// @ts-ignore
Level = { Low: "another object" };
enum Level { High = keep(() => Level) }
console.log(reads[0]() === first, reads[1]() === Level, reads[1]() === first, JSON.stringify(reads[1]()));
enum Named { Named = 5, Other = Named + 1 }
console.log(JSON.stringify(Named));
