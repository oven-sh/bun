// The getters of dates that nobody knows to be dates: the fields that a date keeps are read without a call of native code.
// STATISTIC: DateMethodsCalledByStub >= 4
const log = [];
const read = d => [d.getFullYear(), d.getMonth(), d.getDate(), d.getDay(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getTime()].join();
const attempt = f => { try { log.push(f()); } catch (e) { log.push(e.name + ": " + e.message); } };
const dates = [new Date(0), new Date(86399999), new Date(-1), new Date(2024, 1, 29, 23, 59, 58, 999), new Date(-62198755200000), new Date(8.64e15), new Date(-8.64e15), new Date(NaN), new Date("2007-01-01T01:11:11"), new Date(1e12 + 0.7)];
for (const d of dates) attempt(() => read(d) + " " + read(d));
Date.prototype.shown = function () { return read(this) + "|" + this.getHours() + this.getDay(); };
for (const d of dates) attempt(() => d.shown());
const moved = new Date(1000);
attempt(() => { const r = [read(moved)]; moved.setTime(5e11); r.push(read(moved)); moved.setHours(3, 4, 5); r.push(read(moved)); moved.setTime(NaN); r.push(read(moved)); moved.setFullYear(1999); r.push(read(moved)); return r.join(" "); });
class Late extends Date { getHours() { return "late " + super.getHours(); } get extra() { return this.getMinutes(); } }
class Plain extends Date {}
attempt(() => read(new Late(123456789)) + new Late(123456789).extra);
attempt(() => read(new Plain(123456789)));
const own = new Date(55555555);
own.getHours = () => "own";
attempt(() => read(own));
const accessor = new Date(55555555);
Object.defineProperty(accessor, "getMinutes", { get() { return () => "got"; } });
attempt(() => read(accessor));
attempt(() => read(Object.setPrototypeOf(new Date(5), { __proto__: Date.prototype, getDay() { return "above"; } })));
attempt(() => read(Object.setPrototypeOf(new Date(5), null)));
attempt(() => read(Object.freeze(new Date(77777777777))));
attempt(() => read(new Proxy(new Date(5), {})));
attempt(() => read({ getFullYear: () => 1, getMonth: () => 2, getDate: () => 3, getDay: () => 4, getHours: () => 5, getMinutes: () => 6, getSeconds: () => 7, getTime: () => 8 }));
for (const v of [null, undefined, 5, "text", {}, [], () => 1, Symbol("s")]) attempt(() => read(v));
attempt(() => Date.prototype.getHours.call({}));
attempt(() => [1, 2].map(Date.prototype.getHours, new Date(5)).join());
const { getDate, getTime } = Date.prototype;
attempt(() => getDate.call(dates[3]) + getTime.call(dates[3]));
attempt(() => getDate());
let sum = 0;
for (let i = 0; i < 100; i++) { const d = dates[i % 10]; sum += d.getTime() === d.getTime() ? d.getDay() + d.getMonth() : 1; }
log.push(sum);
console.log(log.join("\n"));
