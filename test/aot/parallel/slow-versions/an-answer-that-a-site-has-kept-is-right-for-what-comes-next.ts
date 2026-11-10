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
    return seen.join(" ");
}
const anything = (value: unknown) => value as Plot;
const parsed = (text: string) => JSON.parse(text);
const outside = (text: string) => (0, eval)("(" + text + ")");
function often(what: string, plots: Plot[]): void {
    const first = areasOf(plots);
    const kinds = new Set<string>([first]);
    let last = first;
    for (let round = 1; round < 4000; round++) kinds.add(last = areasOf(plots));
    console.log(what + ": " + first + (kinds.size > 1 ? " .. " + last + " (" + kinds.size + " answers)" : ""));
}
console.log("written: " + areasOf([{ breadth: 2, depth: 3 }]));

const plain = parsed('{"breadth":2,"depth":3}');
often("one shape", [anything(plain)]);
plain.breadth = 5;
often("a store behind it", [anything(plain)]);
often("the same shape, another object", [anything(parsed('{"breadth":7,"depth":3}'))]);

const counts = outside("{ asked: 0, get breadth() { return ++this.asked; }, depth: 10 }");
often("a getter", [anything(counts)]);
console.log("asked " + counts.asked);

const throwsLater = outside("{ until: 3000, get breadth() { if (!--this.until) throw new RangeError('no breadth'); return 2; }, depth: 1 }");
often("a getter that throws at its call of 3000", [anything(throwsLater)]);

const collects = outside("{ calls: 0, get breadth() { if (!(++this.calls % 1000)) Bun.gc(true); return [1, 2, 3].length; }, depth: 2 }");
often("a getter that collects", [anything(collects)]);

const above = outside("{}");
const lacks = Object.assign(Object.create(above), parsed('{"depth":4}'));
often("lacks the name", [anything(lacks)]);
above.breadth = 6;
often("the object above gets it", [anything(lacks)]);
delete above.breadth;
often("and loses it", [anything(lacks)]);
lacks.breadth = 8;
often("it gets its own", [anything(lacks)]);

const turned = parsed('{"breadth":2,"depth":3}');
often("a value", [anything(turned)]);
Object.defineProperty(turned, "breadth", outside("{ get() { return 9; }, configurable: true }"));
often("turned into a getter", [anything(turned)]);
Object.defineProperty(turned, "breadth", outside("{ value: 4, writable: true, configurable: true }"));
often("and back", [anything(turned)]);

const shapes: Plot[] = [];
for (let shape = 0; shape < 12; shape++) shapes.push(anything(parsed('{"a' + shape + '":1,"breadth":' + (shape + 1) + ',"depth":2}')));
often("twelve shapes in turn", shapes);
often("and the first shape again", [anything(plain)]);
often("two shapes in turn", [anything(plain), anything(lacks)]);
often("a text and a number", [anything("text"), anything(12)]);
often("null between two objects", [anything(plain), anything(null), anything(turned)]);
