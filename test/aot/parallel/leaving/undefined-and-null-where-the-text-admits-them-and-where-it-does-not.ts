// an optional parameter, an optional field and a chain: the program's own branch is taken; where nothing admits them the read throws as written, once
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Node { next?: Node; label: string | null; constructor(label: string | null, next?: Node) { this.label = label; this.next = next; } }
const log: string[] = [];
function describe(node: Node | undefined, deep: boolean): string {
    log.push("describe");
    if (!node) return "none";
    const label = node.label;
    const after = node.next?.label ?? "end";
    return (label === null ? "null" : label.length + label) + ">" + after + (deep && node.next ? ">" + describe(node.next.next, false) : "");
}
function strict(node: Node): string { log.push("strict"); return node.label + "."; }
const describeByValue = through(describe);
const strictByValue = through(strict);
const chain = new Node("a", new Node(null, new Node("ccc")));
for (const value of [chain, chain.next, undefined, null, { label: "lit", next: chain }, { label: null }, { label: "x", next: { label: "y", next: { label: null } } }] as any[]) {
    let strictly: string;
    try { strictly = strictByValue(value); } catch (error) { strictly = (error as Error).constructor.name; }
    console.log(describeByValue(value, true), strictly);
}
console.log(log.length);
