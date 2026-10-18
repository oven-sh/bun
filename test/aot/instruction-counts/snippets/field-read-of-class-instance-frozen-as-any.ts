// reads two fields of an instance of a class that a function taking any value has frozen
class Entry {
  count: number;
  label: string;
  constructor(count: number, label: string) {
    this.count = count;
    this.label = label;
  }
}
const freezeAny = (value: any) => Object.freeze(value);
const operations = 100;
const entries: Entry[] = [];
for (let i = 0; i < operations; i++) entries.push(freezeAny(new Entry(i, "e" + i)));
let total = 0;

kernel: {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    total += entry.count + entry.label.length;
  }
}

console.log(total);
