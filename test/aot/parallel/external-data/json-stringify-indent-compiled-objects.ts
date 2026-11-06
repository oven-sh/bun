// JSON.stringify with an indent writes a compiled object from the list of its fields, as it does without one.
// COUNTER: JSONStringifySlowPaths = 0
const launder = new Function("value", process.argv[2] ?? "return value") as <V>(value: V) => V;
class Leaf { id = 7; name = "leaf"; on = true; off: boolean | null = null; ratio = 1.5; missing: string | undefined = undefined; }
class Empty { }
class OnlyUndefined { a: number | undefined = undefined; }
class Tree { label = "tree \"quoted\" \n line"; leaf = new Leaf(); leaves = [new Leaf(), new Leaf()]; empty = new Empty(); none = new OnlyUndefined(); list: unknown[] = []; mixed: unknown[] = [1, "two", null, new Leaf(), [new Empty()], {}]; aNameOfAFieldThatIsLongerThanSixteenBytes = 1; wide = "中文"; fn = () => 1; symbol = Symbol.iterator; deep = { a: { b: { c: { d: [new Leaf()] } } } }; }
const lines: string[] = [];
for (const space of [1, 2, 4, 10, 11, "\t", "--", "0123456789ab", "", 0, " \n "]) {
    lines.push(JSON.stringify(launder(new Tree()), null, space));
    lines.push(JSON.stringify(launder([new Leaf(), new Empty(), new OnlyUndefined()]), null, space));
    lines.push(JSON.stringify(launder(new Empty()), null, space) + JSON.stringify(launder(new OnlyUndefined()), null, space));
}
const big = launder(Array.from({ length: 300 }, () => new Tree()));
lines.push(String(JSON.stringify(big, null, 3).length), String(JSON.stringify(big, null, "\t\t").length));
let hash = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, hash);
console.log(lines[3]);
