class Plain { constructor(x) { this.x = x; } }
class Hidden { #hidden = 1; peek() { return this.#hidden; } }
class Still { static only = 3; }
class Got { get got() { return 4; } }
class Self { me() { return this; } twice() { return this.me().me(); } }
class Plain2 extends Plain {} class Hidden2 extends Hidden {} class Still2 extends Still {} class Got2 extends Got {} class Self2 extends Self { more() { return 6; } }
const lists = [[new Plain(1), new Plain2(1), 7], [new Hidden(), new Hidden2(), 7], [new Still(), new Still2(), 7], [new Got(), new Got2(), 7], [new Self(), new Self2(), 7]];
for (const list of lists) console.log(`SAID ${list.map(v => typeof v).join(" ")}`);
const selves = [new Self(), new Self2()];
for (const s of selves) console.log(`SAID ${s.twice() === s} ${s instanceof Self2 ? s.twice().more() : "-"}`);
