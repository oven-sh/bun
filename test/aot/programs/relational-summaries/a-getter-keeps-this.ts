// A callee that only reads a member of its parameter keeps the object all the same where the member is a getter that stores `this`. The caller's object may then lie in no frame and be no scalars.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface HasX {
  x: number;
  tag: string;
}
const kept: { tag: string }[] = [];
class Plain {
  constructor(
    public x: number,
    public tag: string,
  ) {}
}
class Spy {
  constructor(
    public hidden: number,
    public tag: string,
  ) {}
  get x(): number {
    kept.push(this);
    return this.hidden;
  }
}
class QuietBase {
  tag = "quiet";
  get x(): number {
    return 1;
  }
}
class LoudHeir extends QuietBase {
  constructor(public tag: string) {
    super();
    this.tag = tag;
  }
  get x(): number {
    kept.push(this);
    return super.x + 1;
  }
}
function readX(p: HasX): number {
  return p.x + 1;
}
function readTwice(p: HasX): number {
  return readX(p) + readX(p);
}
function readThroughThree(p: HasX): number {
  return readTwice(p) - readX(p);
}
let sum = 0;
for (let i = 0; i < 300; i++) {
  sum += readThroughThree(new Plain(i, "plain" + i));
  sum += readThroughThree({ x: i, tag: "literal" + i });
  if (i % 100 === 99) sum += readThroughThree(new Spy(i, "spy" + i));
  if (i % 100 === 50) {
    sum += readThroughThree({
      get x() {
        kept.push(this);
        return i;
      },
      tag: "literal with a getter " + i,
    });
  }
  if (i % 100 === 75) sum += readThroughThree(new LoudHeir("heir" + i));
  if (i % 100 === 25) sum += readThroughThree(new QuietBase());
}
console.log(sum, churn(60), kept.length);
for (let i = 0; i < kept.length; i += 3) console.log(kept[i].tag, kept[i] === kept[i + 1], kept[i + 1] === kept[i + 2], i + 3 < kept.length && kept[i] === kept[i + 3]);

// The getter arrives late, on the prototype of a class, under a name that its instances may have or lack.
class Sparse {
  declare y?: number;
  constructor(public tag: string) {}
}
function withY(tag: string, y: number): Sparse {
  const made = new Sparse(tag);
  made.y = y;
  return made;
}
function readY(p: Sparse): number {
  return p.y === undefined ? -1 : p.y;
}
const late: Sparse[] = [];
let answers = "";
for (let i = 0; i < 60; i++) {
  if (i === 40) {
    Object.defineProperty(Sparse.prototype, "y", {
      get() {
        late.push(this);
        return 1000;
      },
      set(value: number) {
        Object.defineProperty(this, "y", { value, writable: true, enumerable: true, configurable: true });
      },
      configurable: true,
    });
  }
  if (i === 43) delete Sparse.prototype.y;
  const answer = readY(new Sparse("without y " + i)) + readY(withY("with y " + i, i));
  if (i >= 38 && i < 45) answers += answer + " ";
}
console.log(answers, churn(60));
console.log(late.map(o => o.tag).join(" | "));
