// STATISTIC: ReadsThatAskTheirSiteStraight >= 2
type Plot = { breadth: number; depth: number };
const area = (plot: Plot) => plot.breadth * plot.depth;
function areasOf(plots: Plot[]): string {
    const seen: string[] = [];
    for (let at = 0; at < plots.length; at++) {
        try {
            seen.push(String(area(plots[at]!)));
        } catch (error) {
            seen.push((error as Error).constructor.name + ": " + (error as Error).message);
        }
    }
    return seen.join(" | ");
}
const anything = (value: unknown) => value as Plot;
class Inherited { get breadth() { return 6; } }
const heir = Object.assign(Object.create(new Inherited()), { depth: 7 });
let asked = 0;
console.log(areasOf([{ breadth: 2, depth: 3 }, { breadth: 4, depth: 5 }]));
console.log(areasOf(JSON.parse('[{"breadth":2,"depth":3},{"depth":5,"breadth":4},{"breadth":1.5,"depth":2.5,"more":1}]')));
console.log(areasOf([anything({ get breadth() { return ++asked; }, depth: 10 }), anything({ get breadth() { return ++asked; }, depth: 10 })]), asked);
console.log(areasOf([anything({ get breadth(): number { throw new RangeError("no breadth"); }, depth: 1 })]));
console.log(areasOf([anything(new Proxy({}, { get: (_, name) => (name === "breadth" ? 8 : 9) }))]));
console.log(areasOf([anything(heir), anything({ breadth: 3 }), anything("text"), anything(12), anything(true), anything(Symbol.iterator)]));
console.log(areasOf([anything(null)]), areasOf([anything(undefined)]));
console.log(areasOf([anything({ breadth: 3n, depth: 4n })]), areasOf([anything({ breadth: "3", depth: "4" })]));
