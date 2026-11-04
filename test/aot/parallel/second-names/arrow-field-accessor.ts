// An arrow field becomes an accessor through a second name.
const taken = process.argv.length < 99;
const spare: any = JSON.parse("{}");
let shared: any = spare;
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "throws", (error as Error).name); }
};
class Panel { items: number[] = []; open = () => this.n + 1; count = () => this.items.length; n = 1; }
show("entries", () => Object.entries(new Panel()).map(([k, v]) => k + "=" + typeof v).join());
show("accessor", () => { const fresh = new Panel(); if (taken) shared = fresh as any; const before = fresh.count; Object.defineProperty(shared, "count", { get() { return 5; }, configurable: true, enumerable: true }); return typeof fresh.count + "|" + typeof before + "|" + Object.entries(fresh).map(([k, v]) => k + "=" + typeof v).join(); });
export {};
