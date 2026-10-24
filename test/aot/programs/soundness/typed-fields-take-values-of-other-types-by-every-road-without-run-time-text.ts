// A class and a record whose fields are typed, read in a loop by typed code. Each road stores a value of another type into a field, or takes
// the field away, without a typed store: what the typed readers then see is what the language says. No text is evaluated here and there is one realm.

class Node {
    kind: number;
    text: string;
    next: Node | undefined;
    constructor(kind: number, text: string, next?: Node) {
        this.kind = kind;
        this.text = text;
        this.next = next;
    }
}
interface Point { x: number; y: number; label: string; inner: { depth: number } }

function makeNode(index: number): Node { return new Node(index, "n" + index, new Node(index + 1, "m" + index)); }
function makePoint(index: number): Point { return { x: index, y: index * 2, label: "p" + index, inner: { depth: index } }; }

function show(value: unknown): string {
    if (typeof value === "function") return "function";
    if (typeof value === "symbol") return String(value);
    if (typeof value === "bigint") return value + "n";
    if (value === undefined) return "undefined";
    if (Object.is(value, -0)) return "-0";
    if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value.map(show).join() + "]" : "{" + Object.keys(value).join() + "}";
    return JSON.stringify(value);
}
function readNode(node: Node): string {
    let kinds = "";
    try { kinds += show(node.kind) + " " + typeof node.kind + " " + show((node.kind as number) + 1) + " " + show((node.kind as number) | 0); } catch (error) { kinds += "threw " + (error as Error).name; }
    let texts = "";
    try { texts += show(node.text) + " " + show(node.text.length) + " " + show(node.text + "!"); } catch (error) { texts += "threw " + (error as Error).name; }
    let nexts = "";
    try { nexts += show(node.next) + " " + show(node.next === undefined ? "none" : node.next.kind) + " " + show(node.next?.text); } catch (error) { nexts += "threw " + (error as Error).name; }
    return kinds + " | " + texts + " | " + nexts;
}
function readPoint(point: Point): string {
    let out = "";
    try { out += show(point.x) + " " + show(point.x * 2 + point.y) + " " + show(point.label) + " " + show(point.label.length); } catch (error) { out += "threw " + (error as Error).name; }
    try { out += " | " + show(point.inner) + " " + show(point.inner.depth) + " " + show(point.inner.depth + 1); } catch (error) { out += " | threw " + (error as Error).name; }
    return out;
}
function sumKinds(nodes: Node[]): unknown {
    let sum: any = 0;
    for (const node of nodes) sum = sum + node.kind;
    return sum;
}

const misfits: unknown[] = ["text", 0.5, -0, NaN, 2 ** 31, 2 ** 53 + 2, null, undefined, true, 10n, Symbol("s"), { kind: "inner" }, [1, 2], () => 1];

type Road = (object: any, key: string, value: unknown) => any;
const roads: [string, Road][] = [
    ["a cast through any", (object, key, value) => { (object as any)[key] = value; return object; }],
    ["a named store through any", (object, key, value) => { const loose: any = object; if (key === "kind") loose.kind = value; else if (key === "text") loose.text = value; else if (key === "next") loose.next = value; else if (key === "x") loose.x = value; else if (key === "label") loose.label = value; else loose.inner = value; return object; }],
    ["Object.assign", (object, key, value) => Object.assign(object, { [key]: value })],
    ["a spread", (object, key, value) => Object.setPrototypeOf({ ...object, [key]: value }, Object.getPrototypeOf(object))],
    ["Object.defineProperty with a value", (object, key, value) => Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true })],
    ["Object.defineProperty with a getter", (object, key, value) => Object.defineProperty(object, key, { get: () => value, enumerable: true, configurable: true })],
    ["Object.defineProperties", (object, key, value) => Object.defineProperties(object, { [key]: { value, writable: false, enumerable: false, configurable: true } })],
    ["Reflect.set", (object, key, value) => { Reflect.set(object, key, value); return object; }],
    ["Reflect.set with a receiver", (object, key, value) => { Reflect.set({}, key, value, object); return object; }],
    ["Reflect.defineProperty", (object, key, value) => { Reflect.defineProperty(object, key, { value }); return object; }],
    ["a Proxy in its place", (object, key, value) => new Proxy(object, { get: (target, name, receiver) => name === key ? value : Reflect.get(target, name, receiver) })],
    ["a store through a Proxy", (object, key, value) => { (new Proxy(object, {}) as any)[key] = value; return object; }],
    ["delete, then a value on the prototype", (object, key, value) => { delete object[key]; return Object.setPrototypeOf(object, Object.create(Object.getPrototypeOf(object), { [key]: { value, configurable: true, writable: true } })); }],
    ["delete, then a setter on the prototype", (object, key, value) => { delete object[key]; let held = value; const made = Object.setPrototypeOf(object, Object.create(Object.getPrototypeOf(object), { [key]: { get: () => held, set: next => { held = [next]; }, configurable: true } })); made[key] = value; return made; }],
    ["JSON.parse and as", (object, key, value) => { const parsed = JSON.parse(JSON.stringify(object)); parsed[key] = typeof value === "bigint" || typeof value === "symbol" || typeof value === "function" ? String(value as any) : value; return Object.setPrototypeOf(parsed, Object.getPrototypeOf(object)); }],
    ["JSON.parse with a reviver", (object, key, value) => Object.setPrototypeOf(JSON.parse(JSON.stringify(object), function (name, held) { return name === key && this !== undefined && "" in this === false && Object.keys(this).includes(key) && held !== undefined && !("depth" in this) ? value : held; }), Object.getPrototypeOf(object))],
    ["Object.fromEntries", (object, key, value) => Object.setPrototypeOf(Object.fromEntries([...Object.entries(object), [key, value]]), Object.getPrototypeOf(object))],
    ["Object.create with descriptors", (object, key, value) => Object.create(Object.getPrototypeOf(object), { ...Object.getOwnPropertyDescriptors(object), [key]: { value, enumerable: true, writable: true, configurable: true } })],
    ["structuredClone", (object, key, value) => { const clone = structuredClone({ ...object }); clone[key] = value; return Object.setPrototypeOf(clone, Object.getPrototypeOf(object)); }],
    ["Array.prototype.forEach.call over a key list", (object, key, value) => { [key].forEach(function (this: any, name) { this[name] = value; }, object); return object; }],
    ["a bound native", (object, key, value) => { Object.assign.bind(null, object)({ [key]: value }); return object; }],
    ["frozen, then stored", (object, key, value) => { Object.freeze(object); try { object[key] = value; } catch {} return object; }],
];

function attack(name: string, road: Road) {
    const lines: string[] = [];
    for (const key of ["kind", "text", "next"]) {
        for (let index = 0; index < misfits.length; index++) {
            const clean = makeNode(index);
            const before = readNode(clean);
            let after: string;
            let sum: string;
            try {
                const changed = road(makeNode(index), key, misfits[index]) as Node;
                after = readNode(changed);
                try { sum = show(sumKinds([clean, changed, clean])); } catch (error) { sum = "threw " + (error as Error).name; }
            } catch (error) { after = "the road threw " + (error as Error).name; sum = ""; }
            lines.push(key + " " + index + ": " + after + " # " + sum + (readNode(clean) === before ? "" : " THE OTHER OBJECT CHANGED"));
        }
    }
    for (const key of ["x", "label", "inner"]) {
        for (let index = 0; index < misfits.length; index++) {
            let after: string;
            try { after = readPoint(road(makePoint(index), key, misfits[index]) as Point); } catch (error) { after = "the road threw " + (error as Error).name; }
            lines.push(key + " " + index + ": " + after);
        }
    }
    console.log(name + "\n  " + lines.join("\n  "));
}

for (let warm = 0; warm < 2000; warm++) { readNode(makeNode(warm)); readPoint(makePoint(warm)); }
for (const [name, road] of roads) attack(name, road);

const channel = new MessageChannel();
const arrived = new Promise<void>(resolve => {
    channel.port2.onmessage = event => {
        const [node, point] = event.data as [Node, Point];
        console.log("a message\n  " + readNode(node) + "\n  " + readPoint(point));
        channel.port1.close();
        resolve();
    };
});
channel.port1.postMessage([{ kind: "k", text: 5, next: { kind: null } }, { x: "x", y: 1n, label: [1], inner: 7 }]);
await arrived;
