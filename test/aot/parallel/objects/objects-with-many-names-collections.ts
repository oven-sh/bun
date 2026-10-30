// Objects with many names across collections.
const collect = (full: boolean) => (globalThis as unknown as { Bun?: { gc(full: boolean): void } }).Bun?.gc(full);
const events: Record<string, unknown> = Object.create(null);
function on(name: string, listener: unknown) { events[name] = listener; }
for (let i = 0; i < 90; i++) on("option:" + i, () => i);
function Maker(this: any) {}
for (let i = 0; i < 70; i++) (Maker.prototype as any)["method" + i] = function () { return i; };
const bag: any = {};
const names = Array.from({ length: 120 }, (_, i) => "n" + i);
for (const name of names) Object.defineProperty(bag, name, { value: name.length, enumerable: true, writable: true, configurable: true });
const twins: any[] = [];
function twin(k: number) { const made: any = {}; for (let i = 0; i < 40; i++) made["t" + i] = i + k; return made; }
for (let k = 0; k < 3; k++) twins.push(twin(k));
const half: any = {}; for (let i = 0; i < 20; i++) half["t" + i] = -i;
const junk: unknown[] = [];
let sum = 0;
function churn(rounds: number) { for (let i = 0; i < rounds; i++) { junk[i & 1023] = [i, "x" + i, { i }]; sum += i & 3; } }
churn(100000);
collect(false);
bag.later = 1; bag.later2 = 2;
events["option:late"] = 5;
(Maker.prototype as any).late = () => 7;
const after = twin(100);
after.extra = 1; twins[0].extra = 2;
for (let i = 20; i < 40; i++) half["t" + i] = -i;
churn(100000);
collect(false);
const again = twin(200);
half.extra = 3;
churn(100000);
collect(true);
const last = twin(300);
const made = new (Maker as any)();
console.log(sum, Object.keys(events).length, made.method69(), made.late(), Object.keys(bag).length, bag.n119, bag.later2);
console.log(twins.map(t => t.t39).join(), after.t39, after.extra, twins[0].extra, Object.keys(twins[1]).length, JSON.stringify(Object.keys(after).slice(-3)));
console.log(again.t0, again.t39, last.t39, Object.keys(last).join() === Object.keys(twins[1]).join(), half.t39, half.extra, Object.keys(half).length, Object.keys(half).slice(0, 40).join() === Object.keys(last).join());
console.log(delete bag.n5, Object.keys(bag).length, "n5" in bag, delete twins[2].t7, Object.keys(twins[2]).length, twins[1].t7, junk.length);
for (const key in twins[1]) sum += twins[1][key];
console.log(sum, JSON.stringify(twins[1]).length, Object.entries(events).filter(([, value]) => typeof value === "function").length);
