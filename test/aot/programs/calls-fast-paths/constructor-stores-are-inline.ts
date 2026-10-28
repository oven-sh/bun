// A class with many fields that every construction stores to: they lie in the object itself, not in an extension that each construction would have to make and grow.
// CALLS- Panel CreateTypedFieldOutOfLine
class Panel {
  title: string;
  width = 1;
  height = 2;
  items: number[] = [];
  owner: object;
  open = () => this.toggle(true);
  close = () => this.toggle(false);
  grow = () => ++this.width;
  shrink = () => --this.width;
  raise = () => ++this.height;
  lower = () => --this.height;
  add = (item: number) => this.items.push(item);
  clear = () => { this.items.length = 0; };
  describe = () => this.title + ":" + this.width + "x" + this.height + (this.isOpen ? " open" : " closed");
  rename = (title: string) => { this.title = title; };
  count = () => this.items.length;
  first = () => this.items[0];
  last = () => this.items[this.items.length - 1];
  area = () => this.width * this.height;
  isOpen = false;
  note?: string;
  constructor(title: string, owner: object) {
    this.title = title;
    this.owner = owner;
  }
  toggle(open: boolean): boolean { return this.isOpen = open; }
}
const kept: Panel[] = [];
const owner = {};
for (let i = 0; i < 40; i++) {
  const panel = new Panel("p" + i, owner);
  kept.push(panel);
  panel.open();
  panel.grow();
  panel.add(i);
  if (i & 1) panel.note = "odd";
}
console.log(kept.length, kept[3].describe(), kept[3].area(), kept[3].last(), kept[3].note, kept[4].note, Object.keys(kept[3]).join(), Object.keys(kept[4]).length);
const { describe, rename } = kept[5];
rename("renamed");
console.log(describe(), kept[5].describe === describe, kept[5].describe === kept[6].describe, JSON.stringify(kept[5]));
