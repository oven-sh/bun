// What is added for the parameter properties belongs to the class and to no member or function that starts where it is added.
// prettier-ignore
class Tight{first(){return 1}constructor(public held:number){function inside(){return 2}this.text=String(inside)}text:string;static last(){return 3}}
// prettier-ignore
class Below extends Tight{constructor(public more:number){super(more);(function after(){return 4})()}get got(){return this.more}}
const asMethod = (text: string): any => (0, eval)("({" + text + "})");
console.log(asMethod(String(Tight.prototype.first)).first(), String(Tight.prototype.first).startsWith("first("));
console.log(asMethod(String(Tight.last)).last(), String(Tight.last).startsWith("last("));
const tight = new Tight(5);
console.log((0, eval)("(" + tight.text + ")")(), tight.text.startsWith("function inside("));
const got = Object.getOwnPropertyDescriptor(Below.prototype, "got")!.get!;
console.log(String(got).startsWith("get got("), asMethod(String(got)).got === undefined);
const AgainTight = (0, eval)("(" + String(Tight) + ")");
const AgainBelow = (0, eval)("(function (Tight) { return (" + String(Below) + "); })")(AgainTight);
console.log(Object.keys(new AgainTight(6)).join(), new AgainTight(6).held, Object.keys(new AgainBelow(7)).join(), new AgainBelow(7).got);
