// What a name without code yields is data from outside the program: nobody has held it to its type. Where it is cast to a record type, any object
// passes, so no position that it reaches is closed, while the records that the program creates keep their layout. That goes by the cast alone: also in a program
// that parses nothing, reads no file and gets no message.
// IR+ : =?L[0-9]+ = NewObject
// IR- L[0-9]+!
declare const given: any;
interface Kind { flags: number }
const kinds: Kind[] = [];
const a = (typeof given === "undefined" ? undefined : given) as Kind | undefined;
if (a) kinds.push(a);
for (let i = 0; i < 3; i++) kinds.push({ flags: i });
let sum = 0;
for (const kind of kinds) sum += kind.flags;
console.log(sum);
