// `receiver.method(operand())`: the method is read BEFORE the operand runs. Each row lets the operand change the receiver, or hands in a receiver of another kind than is declared.
const log: string[] = [];
function note(text: string) { log.push(text); }
function says(name: string, make: () => unknown): void {
    try {
        const said = make();
        note(name + ": " + typeof said + " " + (Array.isArray(said) ? JSON.stringify(said) : String(said)));
    } catch (error) {
        note(name + ": " + (error as Error).name);
    }
}
export function adds(list: number[], operand: () => number) { return list.push(operand()); }
export function cuts(text: string, operand: () => number) { return text.substring(operand(), 4); }
export function slices(text: string, operand: () => number) { return text.slice(operand()); }
export function sets(table: Map<number, number>, operand: () => number) { return table.set(1, operand()).size; }
export function has(table: Set<number>, operand: () => number) { return table.has(operand()); }
export function splices(list: number[], operand: () => number) { return list.splice(operand(), 1, 9); }
const all = { adds, cuts, slices, sets, has, splices } as Record<string, (receiver: any, operand: () => number) => unknown>;

class Longer extends Array<number> { push(...values: number[]) { note("Longer.push"); return super.push(...values); } }
class Plain extends Array<number> { }
class Counted extends Map<number, number> { set(key: number, value: number) { note("Counted.set"); return super.set(key, value); } }
for (let turn = 0; turn < 3; turn++) {
    const one = () => { note("operand"); return 1; };
    says("a list", () => all.adds([1, 2], one));
    says("fractions", () => all.adds([1.5], one));
    { const list: any = [1]; says("own push written by the operand", () => all.adds(list, () => { list.push = () => "mine"; return 5; })); says("and then", () => JSON.stringify(list) + typeof list.push); says("own push read", () => all.adds(list, one)); }
    { const list = [1]; says("frozen by the operand", () => all.adds(list, () => { Object.freeze(list); return 5; })); says("and then", () => list.length); }
    { const list = [1]; says("another prototype by the operand", () => all.adds(list, () => { Object.setPrototypeOf(list, { push() { return "other"; } }); return 5; })); says("and then", () => list.length + " " + all.adds(list, one)); }
    { const list = [1]; says("emptied by the operand", () => all.adds(list, () => { list.length = 0; return 5; })); says("and then", () => JSON.stringify(list)); }
    { const list = [1]; says("the operand throws", () => all.adds(list, () => { throw new RangeError("no"); })); says("and then", () => list.length); }
    says("a class below with its own push", () => all.adds(new Longer(), one));
    says("a class below without", () => all.adds(new Plain(), one));
    says("null", () => all.adds(null, one));
    says("undefined", () => all.adds(undefined, one));
    says("a number", () => all.adds(5, one));
    says("a getter", () => all.adds({ get push() { note("getter"); return (x: number) => x + 1; } }, one));
    says("no function", () => all.adds({ push: 1 }, one));
    says("a proxy", () => all.adds(new Proxy([1], { get(target, key, receiver) { note("get " + String(key)); return Reflect.get(target, key, receiver); } }), one));
    says("like a list", () => all.adds({ length: 3, push: Array.prototype.push }, one));
    says("a text", () => all.cuts("alphabet", one));
    says("a wide text", () => all.cuts("ЖЗИЙК", one));
    says("a text object", () => all.cuts(new String("alphabet"), one));
    says("a number for a text", () => all.cuts(12345, one));
    says("an object for a text", () => all.cuts({ substring(a: number, b: number) { return a + b; } }, one));
    says("a getter for a text", () => all.cuts({ get substring() { note("getter"); return () => "got"; } }, one));
    says("null for a text", () => all.cuts(null, one));
    says("a list sliced", () => all.slices([1, 2, 3], one));
    says("a text sliced", () => all.slices("alphabet", one));
    says("joined texts sliced", () => all.slices("alpha".concat(String(turn), "bet"), one));
    says("a table", () => all.sets(new Map(), one));
    { const table = new Map([[2, 2]]); says("cleared by the operand", () => all.sets(table, () => { table.clear(); return 5; })); }
    { const table: any = new Map(); says("own set written by the operand", () => all.sets(table, () => { table.set = () => ({ size: "mine" }); return 5; })); says("and then", () => table.size + " " + all.sets(table, one)); }
    says("a class below with its own set", () => all.sets(new Counted(), one));
    says("a weak table", () => all.sets(new WeakMap(), one));
    says("a set for a table", () => all.sets(new Set(), one));
    says("a set", () => all.has(new Set([1]), one));
    says("a table for a set", () => all.has(new Map([[1, 1]]), one));
    says("a weak set", () => all.has(new WeakSet(), one));
    says("an object for a set", () => all.has({ has: (x: number) => x }, one));
    says("spliced", () => all.splices([1, 2, 3], one));
    { const list = [1, 2, 3]; says("sealed by the operand", () => all.splices(list, () => { Object.seal(list); return 0; })); says("and then", () => JSON.stringify(list)); }
}
console.log(log.join("\n"));
