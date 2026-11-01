// As arrow-field-store.ts, with an heir that overrides an arrow field; the store through the second name goes under a key that no build knows.
const taken = process.argv.length > 99;
const spare: any = JSON.parse("{}");
let shared: any = spare;
class Panel {
  title: string;
  width = 1;
  items: number[] = [];
  open = () => this.toggle(true);
  describe = () => this.title + ":" + this.width + (this.isOpen ? " open" : " closed");
  count = () => this.items.length;
  isOpen = false;
  constructor(title: string) { this.title = title; }
  toggle(open: boolean): boolean { return (this.isOpen = open); }
}
class Wide extends Panel { extra = () => this.width * 2; override describe = () => "wide " + this.title; }
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "throws", (error as Error).name); }
};
show("entries", () => Object.entries(new Panel("fresh")).filter(([, value]) => typeof value === "function").map(([key, value]) => key + "=" + (value as Function).name).join());
show("stored to", () => { const fresh = new Panel("fresh"); if (taken) shared = fresh as any; const before = fresh.count; shared[process.argv[98] ?? "count"] = 1; return [typeof fresh.count, typeof before, before === fresh.count, typeof fresh.describe, fresh.describe()].join(); });
show("heir", () => { const wide = new Wide("w"); return [wide.describe(), wide.extra(), wide.open(), wide.count(), Object.keys(wide).join(), wide.describe === wide.describe].join(" "); });
export {};
