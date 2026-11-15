// A property of the list itself under "undefined", "null", "true", "false", laid by name, under a text made at run time, by Object.assign, by a definition of a value: the read under a key that may be undefined finds it, and it is no element.
class Node { id: number; next: number | undefined; constructor(id: number, next?: number) { this.id = id; this.next = next; } }
class Other { id = "other"; }
type Loose = Record<string, unknown>;
const text = (s: string): string => JSON.parse(JSON.stringify(s));
const byName = [new Node(0, 1), new Node(1)]; (byName as unknown as Loose).undefined = new Other();
const byText = [new Node(0, 1), new Node(1)]; (byText as unknown as Loose)[text("undefined")] = new Other();
const byAssign = [new Node(0, 1), new Node(1)]; Object.assign(byAssign, { undefined: new Other(), null: 5 });
const byValue = [new Node(0, 1), new Node(1)]; Object.defineProperty(byValue, "undefined", { value: new Other(), enumerable: true });
const byTruth = [new Node(0, 1), new Node(1)]; (byTruth as unknown as Loose).true = "yes"; (byTruth as unknown as Loose).false = "no";
function walk(nodes: Node[]): string { let out = "", at: number | undefined = 0; for (let i = 0; i < 4; i++) { const n: Node = nodes[at!]!; out += typeof n.id + ":" + n.id + " "; at = n.next; } return out; }
for (const nodes of [byName, byText, byAssign, byValue]) console.log(walk(nodes), Object.keys(nodes).join());
console.log(byTruth[(byTruth.length > 1) as unknown as number], byTruth[(byTruth.length > 5) as unknown as number], byAssign[null as unknown as number]);
const plain = [new Node(0, 1), new Node(1)]; let sum = 0, at: number | undefined = 0; while (at !== undefined) { const n: Node = plain[at]!; sum += n.id + 1; n.id += 10; at = n.next; } console.log(sum, plain[at!], plain[0]!.id, plain[1]!.id);
