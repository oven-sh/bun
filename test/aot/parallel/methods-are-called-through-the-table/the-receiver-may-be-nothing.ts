interface Bell { ring(): string }
class Gong implements Bell { constructor(readonly tone: string) {} ring() { return "gong " + this.tone; } }
class Chime implements Bell { constructor(readonly tone: string) {} ring() { return "chime " + this.tone; } }
function ringAll(bells: (Bell | undefined | null)[]) {
  let said = "";
  for (let place = 0; place < bells.length; place++) {
    try { said += bells[place]!.ring() + ";"; } catch (error) { said += (error as Error).constructor.name + ":" + (error as Error).message + ";"; }
  }
  return said;
}
console.log(ringAll([new Gong("a"), new Chime("b"), undefined, new Gong("c"), null, new Chime("d")]));
const holes: Bell[] = [new Gong("e"), , new Chime("f")] as Bell[];
console.log(ringAll(holes));
let counted = 0;
function count() { counted++; return 1; }
interface Drum { beat(n: number): number }
class Snare implements Drum { constructor(readonly k: number) {} beat(n: number) { return n + this.k; } }
class Tabor implements Drum { constructor(readonly k: number) {} beat(n: number) { return n * this.k; } }
const drums: (Drum | undefined)[] = [new Snare(1), undefined, new Tabor(2)];
for (let place = 0; place < 3; place++) { try { drums[place]!.beat(count()); } catch { } }
console.log(counted);
