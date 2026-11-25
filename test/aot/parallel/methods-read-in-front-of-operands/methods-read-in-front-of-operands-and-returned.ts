// `return receiver.method(operand())`: the call stands in tail position and the method is read BEFORE the operand runs.
const log: string[] = [];
function note(text: string) { log.push(text); }
function says(name: string, make: () => unknown): void {
    try {
        const said = make();
        note(name + ": " + typeof said + " " + (Array.isArray(said) ? JSON.stringify(said) : said instanceof Map ? "table of " + said.size : String(said)));
    } catch (error) {
        note(name + ": " + (error as Error).name);
    }
}
export function adds(list: number[], operand: () => number) { return list.push(operand()); }
export function cuts(text: string, operand: () => number) { return text.substring(operand(), 4); }
export function slices(text: string, operand: () => number) { return text.slice(operand()); }
export function sets(table: Map<number, number>, operand: () => number) { return table.set(1, operand()); }
export function has(table: Set<number>, operand: () => number) { return table.has(operand()); }
export function finds(text: string, operand: () => string) { return text.indexOf(operand()); }
export function joins(list: number[], operand: () => string) { return list.join(operand()); }
const all = { adds, cuts, slices, sets, has, finds, joins } as Record<string, (receiver: any, operand: () => any) => unknown>;

class Longer extends Array<number> { push(...values: number[]) { note("Longer.push"); return super.push(...values); } }
class Counted extends Map<number, number> { set(key: number, value: number) { note("Counted.set"); return super.set(key, value); } }
const turnsBack = { substring(left: number, _: number): unknown { return left > 0 ? all.cuts(turnsBack, () => left - 1) : "came back"; } };
for (let turn = 0; turn < 3; turn++) {
    const one = () => { note("operand"); return 1; };
    says("a list", () => all.adds([1, 2], one));
    { const list: any = [1]; says("own push written by the operand", () => all.adds(list, () => { list.push = () => "mine"; return 5; })); says("and then", () => JSON.stringify(list) + " " + all.adds(list, one)); }
    { const list = [1]; says("frozen by the operand", () => all.adds(list, () => { Object.freeze(list); return 5; })); says("and then", () => list.length); }
    { const list = [1]; says("another prototype by the operand", () => all.adds(list, () => { Object.setPrototypeOf(list, { push() { return "other"; } }); return 5; })); says("and then", () => list.length + " " + all.adds(list, one)); }
    { const list = [1]; says("the operand throws", () => all.adds(list, () => { throw new RangeError("no"); })); says("and then", () => list.length); }
    says("a class below with its own push", () => all.adds(new Longer(), one));
    says("null", () => all.adds(null, one));
    says("a number", () => all.adds(5, one));
    says("a getter", () => all.adds({ get push() { note("getter"); return (x: number) => x + 1; } }, one));
    says("no function", () => all.adds({ push: 1 }, one));
    says("a proxy", () => all.adds(new Proxy([1], { get(target, key, receiver) { note("get " + String(key)); return Reflect.get(target, key, receiver); } }), one));
    says("a text", () => all.cuts("alphabet", one));
    says("a wide text", () => all.cuts("ЖЗИЙК", one));
    says("a text object", () => all.cuts(new String("alphabet"), one));
    says("a number for a text", () => all.cuts(12345, one));
    says("an object for a text", () => all.cuts({ substring(a: number, b: number) { return a + b; } }, one));
    says("null for a text", () => all.cuts(null, one));
    says("a fraction", () => all.cuts("alphabet", () => 1.5));
    says("a text for a number", () => all.cuts("alphabet", () => "2" as any));
    says("two hundred thousand calls in tail position", () => all.cuts(turnsBack, () => 200000));
    says("a list sliced", () => all.slices([1, 2, 3], one));
    says("a text sliced", () => all.slices("alphabet", one));
    says("joined texts sliced", () => all.slices("alpha".concat(String(turn), "bet"), one));
    says("a table", () => all.sets(new Map(), one));
    { const table: any = new Map(); says("own set written by the operand", () => all.sets(table, () => { table.set = () => "mine"; return 5; })); says("and then", () => table.size + " " + all.sets(table, one)); }
    says("a class below with its own set", () => all.sets(new Counted(), one));
    says("a weak table", () => all.sets(new WeakMap(), one));
    says("a set", () => all.has(new Set([1]), one));
    says("a table for a set", () => all.has(new Map([[1, 1]]), one));
    says("an object for a set", () => all.has({ has: (x: number) => x }, one));
    says("found", () => all.finds("alphabet", () => "b"));
    says("found in a list", () => all.finds([1, "b"], () => "b"));
    says("a number sought", () => all.finds("a1", () => 1));
    says("joined", () => all.joins([1, 2, 3], () => "-"));
    says("joined by nothing", () => all.joins([1, [2, 3]], () => undefined));
}
console.log(log.join("\n"));
