// COUNTER: FieldsLeftSlotByStoreOfOtherType >= 8
// Every store of the program brings a text to `label`. The objects reach code that the build has not seen, which stores numbers and objects there. The run time takes the field out of its slot each time,
// so that no read of the program that has seen the slot filled finds anything but a text in it, and the answers are those of plain Bun.
class Holder {
  label: string;
  constructor(seed: number) {
    this.label = "label" + seed;
  }
}

function lengthOf(holder: Holder): unknown {
  return holder.label.length;
}

function between(holder: Holder, deed: (holder: Holder) => void): string {
  const before = holder.label.length;
  deed(holder);
  return before + " " + holder.label.length + " " + typeof holder.label + " " + lengthOf(holder);
}

function inLoop(holder: Holder, deed: (holder: Holder) => void): string {
  let text = "";
  for (let turn = 0; turn < 8; turn++) {
    if (turn === 5) deed(holder);
    text += holder.label.length + ";";
  }
  return text;
}

const unseen = (text: string): any => (0, eval)(text);
console.log(between(new Holder(1), unseen("h => { h.label = 5; }")));
console.log(between(new Holder(1), unseen("h => { h['la' + 'bel'] = { length: 'long' }; }")));
console.log(between(new Holder(1), unseen("h => { Reflect.set(h, 'label', [1, 2, 3]); }")));
console.log(between(new Holder(1), unseen("h => { Object.defineProperty(h, 'label', { value: 7 }); }")));
console.log(between(new Holder(1), unseen("h => { Object.assign(h, { label: true }); }")));
console.log(between(new Holder(1), unseen("h => { new Proxy(h, {}).label = 1.5; }")));
console.log(inLoop(new Holder(1), unseen("h => { h.label = () => 1; }")));
console.log(inLoop(new Holder(1), unseen("h => { h.label = 5; h.label = 'back again'; }")));
