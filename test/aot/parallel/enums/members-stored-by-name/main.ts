// Each enum is stored into through an object that the storing file does not name. Another file reads its member.
import { held } from "./held";
import { Method, Static, Instance, Called, Callback, Rest, Spread, Listed, Property, Keyed, Mapped, Answered, Deleted, Stepped, Printed } from "./kinds";
import { reads } from "./reads";

console.log(reads());
const box = { set(held: any) { held.OfMethod = 9; } };
box.set(Method);
class Kinds { static set(held: any) { held.OfStatic = 9; } }
Kinds.set(Static);
class Patch { constructor(private held: any) {} run() { this.held.OfInstance = 9; } }
new Patch(Instance).run();
function set(this: any) { this.OfCalled = 9; }
set.call(Called);
function using(held: any, run: (held: any) => void) { run(held); }
using(Callback, held => { held.OfCallback = 9; });
function all(...held: any[]) { for (const each of held) each.OfRest = 9; }
all(Rest);
const preceding: any[] = [1, 2];
(function (..._: any[]) { _[2].OfSpread = 9; })(...preceding, Spread);
const list: any[] = [Listed];
list[0].OfListed = 9;
const holder: any = { Property };
holder.Property.OfProperty = 9;
const others: any = { Keyed };
others.Keyed[["Of", "Keyed"].join("")] = 9;
const map = new Map<string, any>([["kind", Mapped]]);
map.get("kind").OfMapped = 9;
const answer = (): any => Answered;
answer().OfAnswered = 9;
(held as any).OfHeld = 9;
for (const each of [Deleted] as any[]) delete each.OfDeleted;
const steps: any[] = [];
steps.push(Stepped);
steps[0].OfStepped++;
console.log(Object.keys(Printed).join(), JSON.stringify({ Printed }));
console.log(reads());
