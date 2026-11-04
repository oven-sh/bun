// The program copies a field from one object to another. Code that the build has not seen has stored a number, an object and an accessor where every store of the program brings a text.
class Holder {
  label: string;
  constructor(seed: number) {
    this.label = "label" + seed;
  }
}

function lengthOf(holder: Holder): unknown {
  return holder.label.length;
}

function copy(to: Holder, from: Holder): unknown {
  to.label = from.label;
  return to.label;
}

function copyInLoop(to: Holder, from: Holder, deed: (holder: Holder) => void): string {
  let text = "";
  for (let turn = 0; turn < 8; turn++) {
    if (turn === 5) deed(from);
    to.label = from.label;
    text += typeof to.label + (to.label == null ? "none" : lengthOf(to)) + ";";
  }
  return text;
}

const unseen = (text: string): any => (0, eval)(text);
const changed = new Holder(2);
unseen("h => { h.label = 9; }")(changed);
const target = new Holder(3);
console.log(copy(target, changed), lengthOf(target), copy(target, new Holder(4)), lengthOf(target));
console.log(copyInLoop(new Holder(5), new Holder(6), unseen("h => { h.label = { length: 'long' }; }")));
console.log(copyInLoop(new Holder(5), new Holder(6), unseen("h => { let reads = 0; Object.defineProperty(h, 'label', { get() { return ++reads; } }); }")));
console.log(copyInLoop(new Holder(5), new Holder(6), unseen("h => { delete h.label; }")));
try {
  console.log(copyInLoop(unseen("Object.freeze")(new Holder(5)), new Holder(6), () => {}));
} catch (error) {
  console.log((error as Error).name);
}
