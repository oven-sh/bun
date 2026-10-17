// What a name without code yields is data from outside the program: nobody has held it to its type. Where it is cast to a record type, that type is
// what the data is expected to be and no more, so the records of the type have no fixed layout. That goes by the cast alone: also in a program
// that parses nothing, reads no file and gets no message.
// IR- NewObjectWithShape
// IR+ NewObject$
declare const given: any;
interface Kind { flags: number }
const kinds: Kind[] = [];
const a = (typeof given === "undefined" ? undefined : given) as Kind | undefined;
if (a) kinds.push(a);
for (let i = 0; i < 3; i++) kinds.push({ flags: i });
let sum = 0;
for (const kind of kinds) sum += kind.flags;
console.log(sum);
