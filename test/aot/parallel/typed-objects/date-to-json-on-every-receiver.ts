// CALLS+ write operationAOTDateToISOString
// CALLS+ writeWithKey operationAOTDateToISOString
// Date.prototype.toJSON: on dates as they are made, on invalid dates, and on every receiver that finds another @@toPrimitive, valueOf, toString or toISOString.
const say = (name: string, run: () => unknown) => {
  try { const said = run(); console.log(name, typeof said, String(said)); } catch (error) { console.log(name, "throws", (error as Error).name); }
};
export function write(date: Date): string | null { return date.toJSON(); }
export function writeWithKey(date: Date): string | null { return date.toJSON("key"); }
// Dates that find other members go through a function of their own: what arrives at a call decides how it is compiled.
export function writeAny(date: Date): string | null { return date.toJSON(); }
const times = [0, 1, -1, 86399999, 951782400000, 1700000000000, 253402300799999, 253402300800000, -62167219200000, -62167219200001, 8.64e15, -8.64e15, 8.64e15 + 1, NaN, Infinity];
for (const time of times) say("time " + time, () => write(new Date(time)));
say("with a key", () => writeWithKey(new Date(5)));
say("fresh", () => new Date(1700000000000).toJSON());
say("fresh and invalid", () => new Date(NaN).toJSON());
say("set invalid later", () => { const date = new Date(5); date.setTime(NaN); return write(date); });
say("own toISOString", () => { const date = new Date(5); (date as any).toISOString = () => "own"; return writeAny(date); });
say("own valueOf", () => { const date = new Date(5); (date as any).valueOf = () => NaN; return writeAny(date); });
say("own valueOf that answers an object", () => { const date = new Date(5); (date as any).valueOf = () => ({}); (date as any).toString = () => "text"; return writeAny(date); });
say("own @@toPrimitive", () => { const date = new Date(5); (date as any)[Symbol.toPrimitive] = () => Infinity; return writeAny(date); });
say("own @@toPrimitive that throws", () => { const date = new Date(5); (date as any)[Symbol.toPrimitive] = () => { throw new RangeError("own"); }; return writeAny(date); });
say("own toJSON", () => { const date = new Date(5); (date as any).toJSON = () => "own toJSON"; return writeAny(date); });
say("own name that is no member", () => { const date = new Date(5); (date as any).extra = 1; return writeAny(date); });
say("another prototype", () => { const date = new Date(5); Object.setPrototypeOf(date, { __proto__: Date.prototype, toISOString: () => "from the prototype" }); return writeAny(date); });
say("no prototype", () => { const date = new Date(5); Object.setPrototypeOf(date, null); return Date.prototype.toJSON.call(date); });
class Below extends Date { toISOString(): string { return "below"; } }
say("a class below Date", () => writeAny(new Below(5)));
class Same extends Date {}
say("a class below Date that adds nothing", () => writeAny(new Same(5)));
say("a plain object", () => Date.prototype.toJSON.call({ toISOString: () => "plain", valueOf: () => 1 }));
say("a plain object without toISOString", () => Date.prototype.toJSON.call({ valueOf: () => 1 }));
say("null", () => writeAny(null as any));
say("frozen", () => writeAny(Object.freeze(new Date(5))));
say("through JSON.stringify", () => JSON.stringify({ at: new Date(5), never: new Date(NaN), list: [new Date(6)] }));
