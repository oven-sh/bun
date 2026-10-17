// An enum member that is a text with a power in it reads as the same text does anywhere else in the program.
const unknown = <T,>(x: T): T => x;
enum Text { Template = `${3 ** 100}`, Joined = "a" + 5 ** 33, OfAMember = `${Template}!`, Number = 3 ** 100, OfANumber = `${Number}`, Both = `${2147483647 ** 0.1}/${7 ** 30}`, Plain = "plain", Exact = `${2 ** 10}` }
const enum Inlined { Template = `${3 ** 100}`, OfAMember = `<${Template}>` }
enum Other { Borrowed = Text.Template, Longer = `${Text.Joined}${Text.Number}` }
const run = String(unknown(3) ** unknown(100));
console.log(Text.Template === run, Text.Joined === "a" + unknown(5) ** unknown(33), Text.OfAMember === run + "!", Text.OfANumber === run);
console.log(Text.Both === unknown(2147483647) ** unknown(0.1) + "/" + unknown(7) ** unknown(30), Text.Plain, Text.Exact);
console.log(Inlined.Template === run, Inlined.OfAMember === "<" + run + ">");
console.log(Other.Borrowed === run, Other.Longer === "a" + unknown(5) ** unknown(33) + run);
console.log(Object.values(Text).includes(run), Object.keys(Text).length, Text.Template === `${3 ** 100}`, { [Text.Template]: 1 }[run]);
switch (run as Text) { case Text.Template: console.log("the case is met"); break; default: console.log("the case is missed"); }
