// A property that no class declares is laid on a class with an heir, counted up, hidden by the heir, made an accessor, and the heir is frozen.
export {}; class Base { static m(): number { return 1; } } class Heir extends Base { static k(): string { return "h"; } }
const all: any[] = [Base, Heir]; const told: string[] = []; all[0].hits = 0;
for (let i = 0; i < 4; i++) { all[0].hits = all[0].hits + 1; told.push(String(all[1].hits)); }
all[1].hits = 50; for (let i = 0; i < 3; i++) { all[0].hits++; told.push(all[1].hits + "/" + all[0].hits); }
Object.defineProperty(Base, "hits", { get() { return "g"; }, set(v) { told.push("s" + v); }, configurable: true });
for (let i = 0; i < 2; i++) all[0].hits = i; told.push(all[0].hits);
Object.freeze(Heir); try { all[1].hits = 9; } catch (e) { told.push((e as Error).constructor.name); } told.push(String(all[1].hits), Object.keys(Base).join(), Object.keys(Heir).join());
console.log(told.join(" "));
