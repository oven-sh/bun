import vm from "node:vm";
type Plot = { breadth: number; depth: number };
const area = (plot: Plot) => plot.breadth * plot.depth;
function areasOf(plots: Plot[]): string {
    const seen: string[] = [];
    for (let at = 0; at < plots.length; at++) seen.push(String(area(plots[at]!)));
    return seen.join(" | ");
}
const written: Plot[] = [{ breadth: 2, depth: 3 }];
const parsed: any[] = JSON.parse('[{"breadth":2,"depth":3},{"breadth":4,"depth":5},{"breadth":6,"depth":7}]');
const show = (what: string) => console.log(what + ": " + areasOf(parsed) + " ; " + areasOf(written));
show("at first");
parsed[0].breadth = 20; show("a store");
delete parsed[1].breadth; show("a field deleted");
parsed[1].breadth = 40; show("and laid again");
Object.defineProperty(parsed[2], "breadth", { get() { return 60; }, configurable: true }); show("a getter in its place");
Object.defineProperty(parsed[2], "breadth", { value: 61, writable: true, configurable: true }); show("a value again");
Object.setPrototypeOf(parsed[0], { depth: 1000 }); delete parsed[0].depth; show("found on a new prototype");
Object.getPrototypeOf(parsed[0]).depth = 2000; show("the prototype stores");
new Function("list", "list[0].breadth = 21; delete list[2].depth; list[2].depth = 71;")(parsed); show("by new Function");
(0, eval)("(list) => { Object.defineProperty(list[1], 'depth', { get() { return 51; }, configurable: true }); }")(parsed); show("by eval");
vm.runInThisContext("(list) => { list[0].breadth = 22; Object.setPrototypeOf(list[0], { depth: 3000 }); }")(parsed); show("by node:vm");
vm.runInNewContext("list[1].breadth = 41; list.push({ breadth: 8, depth: 9 }); list.push(JSON.parse('{\"depth\":11,\"breadth\":10}'));", { list: parsed }); show("by another realm");
Object.freeze(parsed[1]); Object.preventExtensions(parsed[2]); show("frozen");
for (let turn = 0; turn < 300; turn++) { parsed[3]["extra" + turn] = turn; } show("grown to a dictionary");
(written[0] as any).more = 1; delete (written[0] as any).breadth; show("the written one changed too");
