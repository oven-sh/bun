// 1 is stored under each of five keys through a second name that names the object, and the entries are listed.
const taken = process.argv.length < 99;
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
show("stored to each", () => { let t = ""; for (const key of ["open", "describe", "count", "isOpen", "title"]) { const fresh = new Panel("fresh"); if (taken) shared = fresh as any; shared[process.argv[98] ?? key] = 1; t += Object.entries(fresh).map(([k, v]) => k + "=" + typeof v).join() + ";"; } return t; });
show("entries", () => Object.entries(new Panel("fresh")).filter(([, value]) => typeof value === "function").map(([key, value]) => key + "=" + (value as Function).name).join());
show("heir", () => { const wide = new Wide("w"); if (taken) shared = wide as any; shared[process.argv[98] ?? "describe"] = 2; return [typeof wide.describe, wide.extra(), wide.open(), wide.count(), Object.keys(wide).join()].join(" "); });
export {};
