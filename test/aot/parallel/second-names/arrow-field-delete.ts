// Two arrow fields are deleted through a second name.
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
show("deleted", () => { const fresh = new Panel(); if (taken) shared = fresh as any; const before = fresh.count; delete shared.count; delete shared.open; return typeof fresh.count + "|" + typeof before + "|" + typeof fresh.open + "|" + Object.keys(fresh).join(); });
export {};
