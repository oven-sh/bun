// Functions whose prototype is another function with getters, data and methods on it, read again and again while the chain changes in every way.
const lines = [];
function say(what, value) { lines.push(what + " " + value); }
let made = 0;
const styles = Object.defineProperties(function styles() {}, {
    bold: { get() { return build(this, "b"); }, configurable: true },
    level: { get() { return this.depth; }, configurable: true },
    kind: { value: "style", writable: true, configurable: true },
    describe: { value() { return this.path + ":" + this.depth; }, writable: true, configurable: true },
});
function build(parent, code) {
    const builder = text => builder.path + "(" + text + ")";
    Object.setPrototypeOf(builder, styles);
    builder.depth = (parent.depth | 0) + 1;
    builder.path = (parent.path ?? "") + code;
    made++;
    return builder;
}
function readAll(builder) {
    return builder.level + " " + builder.kind + " " + builder.describe() + " " + ("level" in builder) + " " + ("missing" in builder) + " " + builder.missing + " " + builder.length + " " + builder.name;
}
const root = build({}, "r");
const other = build(root, "o");
let seen = new Set();
for (let round = 0; round < 40; round++) seen.add(readAll(round & 1 ? root : other));
say("as made", [...seen].join(" | "));
say("chained", root.bold.bold("x") + " " + root.bold.bold.level + " " + made);

Object.defineProperty(styles, "level", { get() { return -this.depth; }, configurable: true });
say("another getter", readAll(root));
Object.defineProperty(styles, "level", { value: 7, writable: true, configurable: true });
say("data in place of the getter", readAll(root));
styles.kind = "changed";
say("data stored", readAll(root));
root.kind = "own";
say("shadowed", readAll(root) + " | " + readAll(other));
delete root.kind;
say("no longer shadowed", readAll(root));
delete styles.level;
say("deleted above", readAll(root));
styles.missing = "found";
say("added above", readAll(root) + " | " + readAll(other));
delete styles.missing;
say("taken away above", readAll(root));
Object.defineProperty(styles, "level", { get() { return this.depth * 10; }, configurable: true });
for (let round = 0; round < 40; round++) seen.add(readAll(root));
say("a getter again", readAll(root));

const between = function between() {};
between.extra = "between";
Object.setPrototypeOf(between, styles);
Object.setPrototypeOf(other, between);
function readExtra(builder) { return builder.extra + " " + builder.level + " " + ("extra" in builder); }
seen = new Set();
for (let round = 0; round < 40; round++) seen.add(readExtra(round & 1 ? root : other));
say("a function between", [...seen].join(" | "));
Object.defineProperty(between, "level", { value: "from between", configurable: true });
say("the function between answers", readExtra(other) + " | " + readExtra(root));
Object.setPrototypeOf(between, null);
say("the chain is cut", readExtra(other));
Object.setPrototypeOf(other, Function.prototype);
say("back under Function.prototype", readExtra(other) + " " + typeof other.call);

const bare = () => 1;
const underBare = () => 2;
Object.setPrototypeOf(underBare, bare);
function readLate(f) { return f.late + " " + ("late" in f) + " " + f.name + " " + f.length; }
for (let round = 0; round < 40; round++) readLate(underBare);
say("under a function without properties", readLate(underBare));
bare.late = "now";
say("which gets one", readLate(underBare));
delete bare.late;
say("and loses it", readLate(underBare));

styles.displayName = "shown";
say("displayName above", root.displayName + " " + Object.hasOwn(root, "displayName"));
try { root.level = "stored below a getter without a setter"; } catch (error) { say("a store below a getter throws", error.constructor.name); }
say("a store below a getter", root.level + " " + Object.hasOwn(root, "level"));
Object.freeze(styles);
say("frozen above", readAll(root));
console.log(lines.join("\n"));
