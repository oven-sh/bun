// One site reads a name that each visitor finds in the storage of another prototype. Three getters in turn; then the third alone; halfway it is replaced; at the end all three.
const turns = Number(process.argv[2] ?? 900000), hide = value => [value][JSON.parse("0")];
function read(one) { return one.pipe; }
const looks = hide(read), said = [];
function fill(prototype, count, tag) { for (let at = 0; at < count; at++) prototype[tag + at] = at; }
function P() { this.x = 1; } function Q() { this.y = 2; } function S() { this.z = 3; } function T() { this.w = 4; }
fill(P.prototype, 12, "p"); fill(Q.prototype, 15, "q"); fill(S.prototype, 19, "s"); fill(T.prototype, 24, "t");
for (const [each, base] of [[P, 100], [Q, 200], [S, 300], [T, 400]]) Object.defineProperty(each.prototype, "pipe", { get() { return base + (this.x ?? this.y ?? this.z ?? this.w); }, configurable: true, enumerable: true });
const all = hide([new P, new Q, new S]);
let sum = 0;
const tell = value => typeof value === "function" ? value.call(null) : typeof value === "number" ? value : typeof value === "string" ? value.length : value === undefined ? -1 : value === true ? 5 : value === false ? 6 : -3;
for (let turn = 0; turn < turns; turn++) {
    if (turn === turns >> 1) { Object.defineProperty(S.prototype, "pipe", { get() { return 7000 + this.z; }, configurable: true }); }
    const one = turn < turns / 6 || turn > turns - turns / 6 ? all[turn % 3] : all[2];
    const value = looks(one); sum += tell(value);
    if (turn % 4099 === 0) said.push(turn + ":" + tell(value));
    if (turn % 50021 === 0) all[2].z++;
}
console.log(sum, said.join(" "));
