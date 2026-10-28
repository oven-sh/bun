// JSON.stringify of undefined, and of arrays that hold undefined, stays on the fast path.
// COUNTER: JSONStringifySlowPaths = 5
const launder = new Function("value", process.argv[2] ?? "return value") as <V>(value: V) => V;
const seen: unknown[] = [];
function note(value: unknown): void { seen.push(value === undefined ? "undefined" : value); }
class Point { x = 1; y: number | undefined = undefined; }
note(JSON.stringify(undefined)); note(JSON.stringify(launder(undefined))); note(JSON.stringify(undefined, null, 2)); note(JSON.stringify(undefined, undefined, "  "));
note(JSON.stringify([undefined])); note(JSON.stringify(launder([1, undefined, "a", undefined]))); note(JSON.stringify(launder([undefined, { a: undefined, b: [undefined] }]), null, 1));
note(JSON.stringify(launder([new Point(), undefined, new Point(), undefined, new Point()]))); note(JSON.stringify(launder([undefined, new Point()])));
note(JSON.stringify(launder({ a: [undefined, null, 0], b: undefined }))); note(JSON.stringify(launder([[undefined], [[undefined]]])));
note(JSON.stringify(launder([1.5, undefined]))); note(JSON.stringify(launder([, undefined, 1])));
// An array with a hole goes the general way, and so do these four, which run code or ask for it.
note(JSON.stringify(undefined, () => "replaced")); note(JSON.stringify(undefined, ["a"]));
let asked = 0;
note(JSON.stringify(undefined, null, new (class extends Number { valueOf() { asked++; return 2; } })(2) as unknown as number)); note(asked);
note(JSON.stringify([undefined], (key, value) => value === undefined ? "was undefined" : value));
console.log(seen.join(" | "));
