class Texts extends Array<string> { at0(): string | undefined { return this[0]; } joinAll(): string { let s = ""; for (let i = 0; i < this.length; i++) s += this[i]; return s; } each(): string { let s = ""; for (const t of this) s += t; return s; } }
class Points extends Array<{ x: number }> { sum(): number { let n = 0; for (let i = 0; i < this.length; i++) n += this[i]!.x; return n; } each(): number { let n = 0; for (const p of this) n += p.x; return n; } }
class Whole extends Array<number> { sum(): number { let n = 0; for (let i = 0; i < this.length; i++) n += this[i]!; return n; } last(): number | undefined { return this[this.length - 1]; } past(): number | undefined { return this[this.length]; } below(): number | undefined { return this[-1]; } far(i: number): number | undefined { return this[i]; } }
class Mixed extends Array<number | string | null | undefined> { show(): string { let s = ""; for (let i = 0; i < this.length; i++) s += typeof this[i] + ";"; return s; } }
function fill<T, L extends Array<T>>(list: L, ...items: T[]): L { for (const item of items) list.push(item); return list; }
for (let turn = 0; turn < 4; turn++) {
  const texts = fill<string, Texts>(new Texts(), "a", "b", "c"); console.log(texts.at0(), texts.joinAll(), texts.each(), new Texts().at0(), new Texts().joinAll());
  const points = fill<{ x: number }, Points>(new Points(), { x: 1 }, { x: 2 }); console.log(points.sum(), points.each());
  const whole = fill<number, Whole>(new Whole(), 1, 2, 3); console.log(whole.sum(), whole.last(), whole.past(), whole.below(), whole.far(1), whole.far(1.5), whole.far(-0), whole.far(NaN), whole.far(2 ** 32), whole.far(4294967294));
  whole.push(0.5); console.log(whole.sum(), whole.last(), JSON.stringify(whole), whole.indexOf(2), whole.includes(0.5));
  whole.push(NaN); console.log(whole.sum(), whole.last(), whole.includes(NaN), whole.indexOf(NaN));
  (whole as any).push("x"); console.log(whole.sum(), whole.last());
  const big = fill<number, Whole>(new Whole(), 2 ** 31, -(2 ** 31) - 1, 2 ** 53); console.log(big.sum(), big.last());
  const zero = fill<number, Whole>(new Whole(), -0); console.log(Object.is(zero.last(), -0), Object.is(zero.sum(), 0), 1 / zero[0]!);
  const mixed = fill<number | string | null | undefined, Mixed>(new Mixed(), 1, "a", null, undefined, 2.5); console.log(mixed.show());
  const sized = new Whole(5); console.log(sized.sum(), sized.last(), sized.length); sized[4] = 1; console.log(sized.sum(), sized.last());
  const huge = new Whole(); huge[5000000] = 1; console.log(huge.length, huge.last(), huge.far(3), huge.far(5000000));
  const named = fill<number, Whole>(new Whole(), 1, 2); (named as any).tag = "t"; (named as any)["-1"] = 9; (named as any)["1.5"] = 8; console.log(named.sum(), named.below(), named.far(1.5), Object.keys(named).join());
  const kept = fill<number, Whole>(new Whole(), 1, 2, 3); const before = kept.sum(); kept[1] = 20; kept[5] = 6; console.log(before, kept.sum(), kept.length, kept.far(4), 4 in kept);
  delete kept[0]; console.log(kept.sum(), kept.far(0), 0 in kept);
}
