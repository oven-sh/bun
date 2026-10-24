interface Holder { child: Leaf | undefined }
class Leaf { kind = 1; next: Leaf | undefined = undefined }
function put(h: Holder, l: Leaf) { h.child = l }
function read(l: Leaf): number { return l.kind + 1 }
const sneaky: any = { other: true };
const leaf = new Leaf();
put(sneaky, leaf);
const got: any = sneaky.child;
got.kind = "text";
console.log(read(leaf), typeof leaf.kind);

interface Caller { run: (() => number) | undefined }
function install(c: Caller, f: () => number) { c.run = f }
const bag: any = { nothing: 0 };
install(bag, () => 41 + 1);
console.log(bag.run());

function push(list: Leaf[], l: Leaf) { list.push(l) }
const fake: any = { push(x: any) { x.kind = "pushed" } };
const second = new Leaf();
push(fake, second);
console.log(read(second), typeof second.kind);

interface Clock { read(): number; label: string }
function use(c: Clock): string { return c.read() + " " + c.label }
const raw: any = {};
raw.read = () => 1.5;
raw.label = "by name";
console.log(use(raw));
class Other { n = 2; read() { return this.n * 2 } get label() { return "getter" } }
const lie: any = new Other();
console.log(use(lie));
function fill(c: Clock) { c.label = "stored" }
const bare: any = { z: 1 };
fill(bare);
console.log(bare.label, Object.keys(bare).join());
