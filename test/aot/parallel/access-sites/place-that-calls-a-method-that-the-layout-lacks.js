// A function that an object of a class gets under a name made at run time lies beside its fields. `object.name(..)` finds it there.
// EACH PLACE IS WARMED ON ITS OWN: every step has callers of its own, each one place, asked 400 times before anything changes. A caller shared by all steps backs off and is filled no more.
// The steps run in text that the build has not seen, so nothing is known of what a caller is handed and no caller is copied into its own caller.
// No call stands in the tail position: there the function is read first, at a place that reads.
class Node { constructor(kind) { this.kind = kind; } }
const pairs = [
    [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)],
    [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)],
    [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)],
    [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)],
    [o => "" + o.run(1), o => "" + o.check(2, 3)], [o => "" + o.run(1), o => "" + o.check(2, 3)],
];
console.log(new Function("pairs", "Node", `
    const lines = [];
    let next = 0;
    const name = ["r", "un"].join(""), other = ["che", "ck"].join("");
    const run = function (a) { return "run" + this.kind + a; }, check = function (a, b) { return "check" + this.kind + a + b; };
    const make = (i, more) => { const node = new Node(i); node[name] = run; for (let k = 0; k < more; k++) node["x" + k] = k; node[other] = check; return node; };
    const tell = act => { try { return act(); } catch (error) { return error.constructor.name; } };
    const deeds = [
        node => { delete node.run; },
        node => { delete node.run; node[name] = function () { return "again" + this.kind; }; },
        node => { Object.defineProperty(node, "check", { get() { return () => "from a getter"; } }); },
        node => { node.run = function (a) { return "other" + this.kind + a; }; node.check = () => "arrow"; },
        node => { node.run = 7; node.check = undefined; },
        node => { Object.setPrototypeOf(node, { run() { return "above"; } }); delete node.run; },
        node => { Object.freeze(node); },
    ];
    for (const more of [0, 3, 20]) {
        for (const deed of deeds) {
            const [runOf, checkOf] = pairs[next++];
            let last;
            for (let turn = 0; turn < 400; turn++) last = runOf(make(turn, more)) + checkOf(make(turn, more));
            const node = make(1, more);
            deed(node);
            lines.push([last, tell(() => runOf(node)), tell(() => checkOf(node)), runOf(make(2, more)), checkOf(make(2, more)), tell(() => runOf(new Node(3))), tell(() => checkOf(new Node(3)))].join(" "));
        }
    }
    const [runOf, checkOf] = pairs[next++];
    let wrong = 0;
    for (let turn = 0; turn < 1200; turn++) { const node = make(turn, turn % 5); if (runOf(node) !== "run" + turn + 1 || checkOf(node) !== "check" + turn + 23) wrong++; }
    lines.push(wrong);
    return lines.join("\\n");
`)(pairs, Node));
