// Two constructor functions lay a field `tag`. visit() asks its parameter for `tag` alone in front of the switch; in the arms it asks for what Branch alone has.
// So a Branch is expected at the read of `tag`. Everything else that has, lacks, computes or changes a `tag` has to come through the same read with the answer of plain Bun:
// a Trunk (the other constructor), literals, getters, a Proxy, objects below a Branch, a Branch whose tag became a getter, was deleted, was frozen, got another prototype, primitives, null.
// The calls come out of text that the build has not seen, so nothing is known of the parameter but its uses; the objects are made in text that it has seen, so both constructors have a layout.
function Branch(tag, child) { this.tag = tag; this.state = 4; this.child = child; this.sibling = null; }
function Trunk(tag) { this.tag = tag; this.pending = 6; }
function branch(tag, child) { return new Branch(tag, child); }
function trunk(tag) { return new Trunk(tag); }
function visit(node) {
    switch (node.tag) {
    case 1:
        return node.state + 1;
    case 2:
        return node.child === null ? 2 : 10 * visit(node.child);
    case 3:
        return node.sibling === null ? 3 : 30;
    }
    return 0;
}
console.log(new Function("branch", "trunk", "visit", `
    const said = [];
    const say = (label, make) => { let answer; try { answer = String(visit(make())); } catch (error) { answer = error.constructor.name; } said.push(label + " " + answer); };
    for (let round = 0; round < 3; round++) {
        say("branch 1", () => branch(1, null));
        say("branch 2", () => branch(2, null));
        say("branch 2 over 1", () => branch(2, branch(1, null)));
        say("branch 2 over trunk 1", () => branch(2, trunk(1)));
        say("branch 3", () => branch(3, null));
        say("branch 4", () => branch(4, null));
        say("trunk 1", () => trunk(1));
        say("trunk 2", () => trunk(2));
        say("trunk 3", () => trunk(3));
        say("literal", () => ({ tag: 1, state: 7 }));
        say("literal in another order", () => ({ sibling: 1, child: null, state: 8, tag: 3 }));
        say("getter", () => ({ get tag() { return 1; }, state: 9 }));
        say("proxy", () => new Proxy(branch(1, null), { get(target, name) { return name === "tag" ? 3 : target[name]; } }));
        say("below a branch", () => Object.create(branch(1, null)));
        say("tag became a getter", () => Object.defineProperty(branch(1, null), "tag", { get() { return 2; } }));
        say("tag deleted", () => { const branch = branch(1, null); delete branch.tag; return branch; });
        say("tag deleted, found above", () => { const branch = branch(1, null); delete branch.tag; Object.setPrototypeOf(branch, { tag: 3 }); return branch; });
        say("frozen", () => Object.freeze(branch(1, null)));
        say("tag stored again", () => { const branch = branch(1, null); branch.tag = 3; branch.sibling = branch; return branch; });
        say("a text as tag", () => branch("1", null));
        say("a double as tag", () => branch(Number("0.5") * 2, null));
        say("more names", () => Object.assign(branch(2, null), { extra: 1 }));
        say("number", () => 5);
        say("text", () => "tag");
        say("undefined", () => undefined);
        say("null", () => null);
    }
    return said.join("\\n");
`)(branch, trunk, visit));
