const dates = () => [new Date(1710054000123), new Date(-1), new Date(NaN), new Date(8.64e15), new (class extends Date {})(5), { getTime: Date.prototype.getTime }];
for (const name of Object.getOwnPropertyNames(Date.prototype)) {
  if (/^get|toISO|toJSON/.test(name)) check(`d => { const before = Date.prototype.${name}.call(d); d.setTime(9e11); return [before, d.${name}()]; }`, oneOf(dates));
  if (/^set/.test(name)) check(`(d, a) => [d.getTime(), d.${name}(a), d.getUTCDay(), d.${name}(a, 3), d.getTime(), d.getHours()]`, across(dates, () => [1, 70.5, NaN, null, "2"]));
}
check((a, b) => [+new Date(a), +new Date(a, b), +new Date(a, b, 3, 4, 5, 6, 7), Date.UTC(a, b), Date.UTC(a, b, 2, 3), Date.parse(a)],
  () => [[2024, 1], [99, 12], [1.5, NaN], ["2024-02-03", 1], [joined("2024", "-02"), null], [new Date(5), 0]]);
check((a, b) => { const before = [a.getUTCFullYear(), a.getUTCMonth(), a.getTime()]; b.setTime(4e11); return [before, a.getUTCFullYear(), a.getUTCMonth(), a.getTime()]; },
  () => { const same = new Date(0); return [[new Date(0), new Date(0)], [same, same]]; });
check(t => { const d = new Date(t); return [d.getTime(), Object.is(d.getTime(), -0), d.getMinutes(), d.getUTCMinutes(), d.getUTCMilliseconds(), new Date(d).getUTCDay(), d.setTime(-t), d.getUTCFullYear()]; }, oneOf(() => [5, -1, -0, -0.5, 1e12 + 0.5, 8.64e15, 8.64e15 + 2, NaN, -6e13]));
class Derived extends Date { constructor(time) { super(time); } }
check(t => new Derived(t) instanceof Derived, () => [[1]]);
check(() => { const a = Date.now(), b = +new Date(); return [Number.isInteger(a), a <= b, new Date() !== new Date()]; }, () => [[]]);
check((d, a, b) => { d.setTime(a); const before = [d.getUTCHours(), d.getHours()]; d.setTime(b); return [before, d.getUTCHours(), d.getHours()]; }, () => [[new Date(0), 36e5, 72e5]]);
check((d, a, b) => { d.setTime(a); const before = d.toISOString(); d.setTime(b); return [before, d]; }, () => [[new Date(0), 36e5, 72e5]]);
check((a, b) => { const d = new Date(a), before = d.getUTCHours(); d.setTime(b); return [before, d]; }, () => [[36e5, 72e5]]);
