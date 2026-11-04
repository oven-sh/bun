// The arrow fields of an object that is built late are made, then stored. One of them is written through a second name elsewhere, so a read of it rests on those stores.
const taken = process.argv.length > 99;
const spare: any = JSON.parse("{}");
let shared: any = spare;
class Panel {
  items: number[] = [];
  open = () => this.toggle(true);
  count = () => this.items.length;
  isOpen = false;
  toggle(open: boolean): boolean { return (this.isOpen = open); }
}
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "throws", (error as Error).name); }
};
show("entries", () => Object.entries(new Panel()).filter(([, value]) => typeof value === "function").map(([key, value]) => key + "=" + (value as Function).name).join());
show("stored to", () => { const fresh = new Panel(); if (taken) shared = fresh as any; const before = fresh.count; shared.count = 1.5; fresh.count = () => 7; return [fresh.count(), before(), before === fresh.count].join(); });
export {};
