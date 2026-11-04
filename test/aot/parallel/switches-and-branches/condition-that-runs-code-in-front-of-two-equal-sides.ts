// both sides of a branch come to one place, so nobody asks the test. What computes the condition still runs: a getter, a call, an `in` on a proxy, a comparison that converts
let log = "";
const counted = { get flag() { log += "get;"; return 1; } };
const trapped = new Proxy({}, { has(target, key) { log += "has " + String(key) + ";"; return false; } });
const converted = { valueOf() { log += "valueOf;"; return 1; } };
function byGetter(o: { flag: unknown }) { if (o.flag) { } return log; }
function byCall(f: () => unknown) { if (f()) { } else { } return log; }
function byIn(o: object) { const x = "key" in o ? 1 : 1; return log + x; }
function byComparison(o: any) { if (o < 2) { } return log; }
function byThrow(o: any) { try { if (o.flag.deep) { } return "fine"; } catch (e) { return (e as Error).name; } }
function deed() { log = ""; return byGetter(counted) + "|" + byCall(() => { log += "call;"; return 0; }) + "|" + byIn(trapped) + "|" + byComparison(converted) + "|" + byThrow({}) + byThrow({ flag: {} }); }
console.log(deed());
let text = "";
for (let i = 0; i < 3; i++) text += deed() + " ";
console.log(text);
