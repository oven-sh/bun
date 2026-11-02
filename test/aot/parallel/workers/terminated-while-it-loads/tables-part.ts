export class Entry {
  static all: Entry[] = [];
  constructor(public id: number, public name: string) {
    Entry.all.push(this);
  }
}
export function build(count: number): number {
  Entry.all.length = 0;
  for (let i = 0; i < count; i++) new Entry(i, "e" + i);
  return Entry.all.length;
}
