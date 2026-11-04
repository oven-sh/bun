// A property that an object of a class gets under a name made at run time lies beside its fields.
// EACH PLACE IS WARMED ON ITS OWN: every step has a reader of its own, which is one place, asked 400 times before anything changes. A reader shared by all steps backs off and is filled no more.
// The steps run in text that the build has not seen, so nothing is known of what a reader is handed and no reader is copied into its caller.
class Node { constructor(kind) { this.kind = kind; } }
const readers = [o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent, o => o.symbol, o => o.parent];
console.log(new Function("readers", "Node", `
    const lines = [];
    let next = 0;
    const name = ["sym", "bol"].join(""), other = ["par", "ent"].join("");
    const make = (i, more) => { const node = new Node(i); node[name] = "s" + i; for (let k = 0; k < more; k++) node["x" + k] = k; node[other] = i; return node; };
    const deeds = [
        node => { delete node.symbol; },
        node => { delete node.symbol; node[name] = "again"; },
        node => { Object.defineProperty(node, "parent", { get() { return "getter"; } }); },
        node => { node.symbol = 7; node.parent = "text"; },
    ];
    for (const more of [0, 3, 20]) {
        for (const deed of deeds) {
            const symbolOf = readers[next++], parentOf = readers[next++];
            let last;
            for (let turn = 0; turn < 400; turn++) last = symbolOf(make(turn, more)) + parentOf(make(turn, more));
            const node = make(1, more);
            deed(node);
            lines.push(last + " " + symbolOf(node) + " " + parentOf(node) + " " + symbolOf(make(2, more)) + " " + parentOf(make(2, more)) + " " + symbolOf(new Node(3)) + " " + parentOf(new Node(3)));
        }
    }
    const symbolOf = readers[next++], parentOf = readers[next++];
    let wrong = 0;
    for (let turn = 0; turn < 1200; turn++) { const node = make(turn, turn % 5); if (symbolOf(node) !== "s" + turn || parentOf(node) !== turn) wrong++; }
    lines.push(wrong);
    return lines.join("\\n");
`)(readers, Node));
