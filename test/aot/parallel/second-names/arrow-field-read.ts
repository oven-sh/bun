// As arrow-field-store.ts; the second name names the object, and the field is read behind the store.
const taken = process.argv.length < 99;
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
show("read behind the store", () => { const fresh = new Panel(); if (taken) shared = fresh as any; const before = fresh.count; shared.count = 1.5; return typeof fresh.count + "|" + typeof before + "|" + (before === fresh.count) + "|" + typeof fresh.open; });
export {};
