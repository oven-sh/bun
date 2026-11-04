const report = (value: unknown) => console.log(String(value));
const kState = Symbol.for("registered.state");
const kCount = Symbol.for("registered.count");
const kOwn = Symbol("registered.state");
interface Holder { [kState]: string | null; [kCount]: number; [kOwn]: string; name: string; }
function Holder(this: Holder, name: string) { this.name = name; this[kState] = null; this[kOwn] = "own"; this[kCount] = 0; }
Holder.prototype.bump = function (this: Holder) { this[kCount] += 1; this[kState] = "bumped " + this[kCount]; return this; };
class Boxed { [kState]: string = "boxed"; [kCount] = 7; plain = 1; }
const spell = (parts: string[]) => Symbol.for(parts.join("."));
const show = (o: any) => Reflect.ownKeys(o).map(String).join() + "|" + String(o[kState]) + "|" + String(o[kCount]);
const made: any = new (Holder as any)("first");
report(show(made));
report(show(made.bump().bump()));
report(kState === spell(["registered", "state"]));
report((kState as symbol) === (kOwn as symbol));
report(Symbol.keyFor(kState));
report(Symbol.keyFor(kOwn));
report(kState.description);
report(made[spell(["registered", "count"])]);
made[spell(["registered", "state"])] = "through the registry";
report(made[kState]);
const outside = new Function("o", "o[Symbol.for('registered.count')] += 40; return Symbol.for('registered.state') in o;");
report(outside(made));
report(made[kCount]);
report(delete made[spell(["registered", "count"])]);
report(show(made));
made[kCount] = 5;
report(show(made));
const boxed = new Boxed();
report(show(boxed));
report(Object.getOwnPropertySymbols(boxed).map(s => Symbol.keyFor(s)).join());
let same = 0;
const seen: symbol[] = [];
for (let i = 0; i < 3; i++) { const inLoop = Symbol.for("registered.loop"); const fresh = Symbol("registered.loop"); seen.push(fresh); if (inLoop === Symbol.for("registered.loop")) same++; (made as any)[inLoop] = i; }
report(same);
report(new Set(seen).size);
report((made as any)[Symbol.for("registered.loop")]);
const literal = { [kState]: "literal", other: 2, [kCount]: 3 };
report(show(literal));
report(JSON.stringify(literal));
const { [kState]: taken, ...rest } = literal;
report(taken + "|" + show(rest));
report(Object.prototype.hasOwnProperty.call(made, kState) + "|" + (kCount in boxed) + "|" + Object.hasOwn(rest, kState));
report("end");
