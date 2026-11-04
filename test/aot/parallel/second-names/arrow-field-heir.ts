// The arrow fields of a class and of its heir, written through a second name.
const taken = process.argv.length < 99;
const spare: any = JSON.parse("{}");
let shared: any = spare;
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "throws", (error as Error).name); }
};
class Panel { items: number[] = []; open = () => this.n + 1; count = () => this.items.length; n = 1; }
class Wide extends Panel { extra = () => this.n * 2; more = () => this.n * 3; }
show("entries", () => Object.entries(new Wide()).map(([k, v]) => k + "=" + typeof v).join());
show("store", () => { const fresh = new Wide(); if (taken) shared = fresh as any; const before = fresh.more; shared.more = 1.5; shared.count = 2.5; return typeof fresh.more + "|" + typeof before + "|" + typeof fresh.count; });
export {};
