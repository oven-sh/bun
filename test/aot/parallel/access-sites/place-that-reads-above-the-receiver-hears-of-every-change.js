// What a place remembers of the objects above a receiver ends when one of them changes.
// EACH PLACE IS WARMED ON ITS OWN: every step has a reader of its own, which is one place, asked 400 times before anything changes. A reader shared by all steps backs off and is filled no more.
// The steps run in text that the build has not seen, so nothing is known of what a reader is handed and no reader is copied into its caller.
const root = { kind: "root" };
const middle = Object.create(root);
const many = Object.create(middle); for (let i = 0; i < 40; i++) many["p" + i] = i;
class Leaf { constructor() { this.own = 1; } }
Object.setPrototypeOf(Leaf.prototype, many);
const readers = [o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30, o => o.kind, o => o.p30];
const plain = () => Object.create(many), leaf = () => new Leaf();
console.log(new Function("readers", "makers", "root", "middle", "many", `
    const lines = [];
    let next = 0;
    const steps = [
        () => { root.kind = "replaced"; many.p30 = "replaced"; },
        () => { middle.kind = "in between"; },
        () => { delete middle.kind; },
        () => { delete many.p30; },
        () => { many.p30 = 30; },
        () => { Object.defineProperty(root, "kind", { get() { return "getter"; }, configurable: true }); },
        () => { Object.defineProperty(root, "kind", { value: "root", writable: true, configurable: true, enumerable: true }); },
        () => { Object.setPrototypeOf(middle, { kind: "other root" }); },
        () => { Object.setPrototypeOf(middle, root); },
        () => { delete root.kind; },
        () => { root.kind = "root"; },
        () => { Object.defineProperty(many, "p30", { get() { return "getter of p30"; }, configurable: true }); },
        () => { delete many.p30; many.p30 = 30; },
    ];
    for (const make of makers) {
        for (const step of steps) {
            const kindOf = readers[next++], p30Of = readers[next++];
            let before;
            for (let turn = 0; turn < 400; turn++) before = kindOf(make()) + " " + p30Of(make());
            step();
            lines.push(before + " > " + kindOf(make()) + " " + p30Of(make()));
            for (let turn = 0; turn < 400; turn++) before = kindOf(make()) + " " + p30Of(make());
            lines.push(before);
            const shadowed = make(); shadowed.kind = "own";
            const moved = make(); Object.setPrototypeOf(moved, { kind: "moved" });
            lines.push(kindOf(shadowed) + " " + kindOf(moved) + " " + p30Of(moved) + " " + kindOf(make()));
        }
    }
    return lines.join("\\n");
`)(readers, [plain, leaf], root, middle, many));
