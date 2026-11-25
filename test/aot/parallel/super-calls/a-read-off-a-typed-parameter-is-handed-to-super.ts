class Options { name: string; constructor(n: string) { this.name = n; } }
class Above { name: string; constructor(name: string) { this.name = name; } }
class Below extends Above { constructor(options: Options) { super(options.name); } }
const hand: (o: Options) => Options = (0, eval)("(o) => o");
function one(o: Options) { return new Below(o).name; }
function run(n: number) { const out: string[] = []; for (let i = 0; i < n; i++) out.push(new Below(hand(new Options("n" + i))).name, one(hand(new Options("o" + i)))); return out.join(" "); }
console.log(run(3));
