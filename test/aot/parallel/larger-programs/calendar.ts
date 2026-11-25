// Calendars: days without time zones, rules that recur, exceptions, free time, agendas, a small language of dates, weeks and months printed, holidays that depend on others
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const, MONTHS = ["jan",
  "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
class Day {
  private constructor(readonly number: number) {
  }
  static readonly #kept = new Map<number, Day>();
  static made = 0;
  static of(number: number): Day {
    let d = Day.#kept.get(number);
    if (!d) {
      d = new Day(number);
      Day.made++;
      if (Day.#kept.size < 5000) Day.#kept.set(number, d);
    }
    return d;
  }
  static ymd(y: number, m: number, d: number): Day {
    if (m < 1 || m > 12 || d < 1 || d > Day.daysIn(y,
      m)) throw new RangeError(`no such day ${y}-${m}-${d}`);
    const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
    return Day.of(d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045 - 2440588);
  }
  static parse(text: string): Day {
    const m = /^(\d{4})-(\d\d?)-(\d\d?)$/.exec(text);
    if (!m) throw new SyntaxError("bad day " + text);
    return Day.ymd(+m[1], +m[2], +m[3]);
  }
  static isLeap(y: number) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }
  static daysIn(y: number, m: number) {
    return m === 2 ? (Day.isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
  }
  get parts(): {
    y: number;
    m: number;
    d: number
  }
  {
    const a = this.number + 2440588 + 32044, b = Math.floor((4 * a + 3) / 146097),
      c = a - Math.floor((146097 * b) / 4), d = Math.floor((4 * c + 3) / 1461),
      e = c - Math.floor((1461 * d) / 4), m = Math.floor((5 * e + 2) / 153);
    return {
      d: e - Math.floor((153 * m + 2) / 5) + 1, m: m + 3 - 12 * Math.floor(m / 10),
        y: 100 * b + d - 4800 + Math.floor(m / 10)
  };
  }
  get weekday(): Weekday {
    return ((((this.number + 3) % 7) + 7) % 7) as Weekday;
  }
  get week(): [number, number] {
    const thursday = this.plus(3 - this.weekday), {
      y
  } = thursday.parts;
    return [y, Math.floor((thursday.number - Day.ymd(y, 1, 1).number) / 7) + 1];
  }
  plus(n: number) {
    return Day.of(this.number + n);
  }
  plusMonths(n: number): Day {
    const {
      y, m, d
  } = this.parts, t = y * 12 + m - 1 + n, yy = Math.floor(t / 12), mm = (t % 12 + 12) % 12 + 1;
    return Day.ymd(yy, mm, Math.min(d, Day.daysIn(yy, mm)));
  }
  until(o: Day) {
    return o.number - this.number;
  }
  compare(o: Day) {
    return this.number - o.number;
  }
  valueOf() {
    return this.number;
  }
  toString() {
    const {
      y, m, d
  } = this.parts;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  toJSON() {
    return String(this);
  }
  static easter(y: number): Day {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return Day.ymd(y, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
  }
}
class Span implements Iterable<Day> {
  constructor(readonly from: Day, readonly to: Day) {
    if (to < from) throw new RangeError(`${from} to ${to}`);
  }
  get length() {
    return this.from.until(this.to);
  }
  has(d: Day) {
    return d >= this.from && d < this.to;
  }
  *[Symbol.iterator]() {
    for (let n = this.from.number; n < this.to.number; n++) yield Day.of(n);
  }
  overlap(o: Span): Span | null {
    const a = this.from > o.from ? this.from : o.from, b = this.to < o.to ? this.to : o.to;
    return a < b ? new Span(a, b) : null;
  }
  toString() {
    return `${this.from}..${this.to}`;
  }
}
abstract class Rule {
  count = Infinity;
  last: Day | null = null;
  readonly #except = new Set<number>();
  times(n: number): this {
    this.count = n;
    return this;
  }
  until(d: Day): this {
    this.last = d;
    return this;
  }
  but(...days: Day[]): this {
    for (const d of days) this.#except.add(d.number);
    return this;
  }
  protected abstract days(start: Day): Generator<Day>;
  abstract toString(): string;
  *from(start: Day): Generator<Day> {
    let n = 0;
    for (const d of this.days(start)) {
      if (d < start) continue;
      if (n++ >= this.count || (this.last && d > this.last)) return;
      if (!this.#except.has(d.number)) yield d;
    }
} in(start: Day, span: Span): Day[] {
    const out: Day[] = [];
    for (const d of this.from(start)) {
      if (d >= span.to) break;
      if (d >= span.from) out.push(d);
    }
    return out;
  }
  and(o: Rule): Rule {
    return new Both(this, o);
  }
}
class Daily extends Rule {
  constructor(readonly every = 1) {
    super();
    if (!(every >= 1)) throw new RangeError("every " + every);
  }
  protected *days(start: Day) {
    for (let d = start; ; d = d.plus(this.every)) yield d;
  }
  toString() {
    return this.every === 1 ? "daily" : `every ${this.every} days`;
  }
}
class Weekly extends Rule {
  readonly #on: readonly Weekday[];
  constructor(on: readonly Weekday[], readonly every = 1) {
    super();
    this.#on = [...on].sort();
    if (!on.length) throw new RangeError("no weekdays");
  }
  protected *days(start: Day) {
    for (let monday = start.plus(-start.weekday); ; monday = monday.plus(7 * this.every)) for (const w of this.#on) yield monday.plus(w);
  }
  toString() {
    return `${this.every === 1 ? "weekly" : `every ${this.every} weeks`} on ${this.#on.map(w => WEEKDAYS[w]).join()}`;
  }
}
class Monthly extends Rule {
  constructor(readonly which: { day: number } | { nth: number; weekday: Weekday },
    readonly every = 1) {
    super();
  }
  protected *days(start: Day) {
    let {
      y, m
  } = start.parts;
    for (;;) {
      const d = this.#pick(y, m);
      if (d) yield d;
      m += this.every;
      while (m > 12) {
        m -= 12;
        y++;
      }
    }
  }
  #pick(y: number, m: number): Day | null {
    const n = Day.daysIn(y, m);
    if ("day" in this.which) {
      const d = this.which.day < 0 ? n + 1 + this.which.day : this.which.day;
      return d >= 1 && d <= n ? Day.ymd(y, m, d) : null;
    }
    const {
      nth, weekday
  } = this.which;
    if (nth > 0) {
      const first = Day.ymd(y, m, 1),
        d = first.plus(((weekday - first.weekday + 7) % 7) + 7 * (nth - 1));
      return d.parts.m === m ? d : null;
    }
    const last = Day.ymd(y, m, n),
      d = last.plus(-((last.weekday - weekday + 7) % 7) + 7 * (nth + 1));
    return d.parts.m === m ? d : null;
  }
  toString() {
    return "day" in this.which ? `monthly on ${this.which.day}` : `monthly on ${this.which.nth}. ${WEEKDAYS[this.which.weekday]}`;
  }
}
class Yearly extends Rule {
  constructor(readonly pick: (y: number) => Day | null, readonly label: string) {
    super();
  }
  protected *days(start: Day) {
    for (let y = start.parts.y; ; y++) {
      const d = this.pick(y);
      if (d) yield d;
    }
  }
  toString() {
    return "yearly " + this.label;
  }
}
class Both extends Rule {
  constructor(readonly a: Rule, readonly b: Rule) {
    super();
  }
  protected *days(start: Day) {
    const x = this.a.from(start), y = this.b.from(start);
    let p = x.next(), q = y.next();
    while (!p.done || !q.done) {
      if (q.done || (!p.done && p.value < q.value)) {
        yield p.value!;
        p = x.next();
    } else if (p.done || q.value < p.value) {
        yield q.value;
        q = y.next();
    } else {
        yield p.value;
        p = x.next();
        q = y.next();
      }
    }
  }
  toString() {
    return `${this.a} and ${this.b}`;
  }
}
class RuleParser {
  #words: string[];
  #i = 0;
  constructor(readonly text: string) {
    this.#words = text.toLowerCase().match(/[a-z]+|-?\d{4}-\d\d?-\d\d?|-?\d+|,/g) ?? [];
  }
  #take(...w: string[]) {
    if (w.includes(this.#words[this.#i])) return this.#words[this.#i++];
    return null;
  }
  #number() {
    const n = Number(this.#words[this.#i]);
    if (!Number.isInteger(n)) throw new SyntaxError(`expected a number in "${this.text}"`);
    this.#i++;
    return n;
  }
  #weekdays(): Weekday[] {
    const out: Weekday[] = [];
    do {
      const w = WEEKDAYS.findIndex(x => this.#words[this.#i]?.startsWith(x));
      if (w < 0) throw new SyntaxError(`expected a weekday in "${this.text}"`);
      out.push(w as Weekday);
      this.#i++;
  } while (this.#take(",", "and"));
    return out;
  }
  parse(): Rule {
    let rule = this.#one();
    for (;;) {
      if (this.#take("until")) rule.until(Day.parse(this.#words[this.#i++]));
      else if (this.#take("except")) {
        do rule.but(Day.parse(this.#words[this.#i++]));
        while (this.#take(","));
    } else if (this.#take("times")) rule.times(this.#number());
      else if (this.#take("plus")) rule = rule.and(this.#one());
      else break;
    }
    if (this.#i < this.#words.length) throw new SyntaxError(`more in "${this.text}": ${this.#words[this.#i]}`);
    return rule;
  }
  #one(): Rule {
    if (this.#take("daily")) return new Daily();
    if (this.#take("weekdays")) return new Weekly([0, 1, 2, 3, 4]);
    if (this.#take("every")) {
      const n = /^\d+$/.test(this.#words[this.#i] ?? "") ? this.#number() : 1;
      if (this.#take("day", "days")) return new Daily(n);
      if (this.#take("week", "weeks")) {
        if (!this.#take("on")) throw new SyntaxError(`expected "on" in "${this.text}"`);
        return new Weekly(this.#weekdays(), n);
      }
      if (this.#take("month", "months")) {
        this.#take("on");
        const nth = this.#take("first", "second", "third", "fourth", "last");
        if (nth) return new Monthly({ nth: nth === "last" ? -1 : ["first", "second", "third",
          "fourth"].indexOf(nth) + 1, weekday: this.#weekdays()[0] }, n);
        return new Monthly({ day: this.#number() }, n);
      }
      return new Weekly(this.#weekdays(), n);
    }
    if (this.#take("yearly")) {
      this.#take("on");
      if (this.#take("easter")) {
        const by = this.#take("plus") ? this.#number() : 0;
        return new Yearly(y => Day.easter(y).plus(by), "easter+" + by);
      }
      const m = MONTHS.findIndex(x => this.#words[this.#i]?.startsWith(x)) + 1;
      if (!m) throw new SyntaxError(`expected a month in "${this.text}"`);
      this.#i++;
      const d = this.#number();
      return new Yearly(y => (d <= Day.daysIn(y, m) ? Day.ymd(y, m, d) : null),
        `${MONTHS[m - 1]} ${d}`);
    }
    throw new SyntaxError(`cannot read "${this.text}"`);
  }
}
interface Event {
  readonly id: number;
  title: string;
  start: Day;
  days: number;
  rule: Rule | null;
  tags: ReadonlySet<string>
}
class Calendar {
  readonly #events = new Map<number, Event>();
  #next = 1;
  readonly #cache = new Map<string, readonly {
    day: Day;
    event: Event
}[]>();
  expanded = 0;
  add(title: string, start: Day, { days = 1, rule = null,
    tags = [] }: { days?: number; rule?: string | Rule | null; tags?: string[] } = {}): Event {
    const e: Event = {
      id: this.#next++, title, start, days,
        rule: typeof rule === "string" ? new RuleParser(rule).parse() : rule,
        tags: new Set(tags)
  };
    this.#events.set(e.id, e);
    this.#cache.clear();
    return e;
  }
  remove(id: number) {
    this.#cache.clear();
    return this.#events.delete(id);
  }
  move(id: number, by: number) {
    const e = this.#events.get(id);
    if (!e) throw new ReferenceError("no event " + id);
    e.start = e.start.plus(by);
    this.#cache.clear();
  }
  agenda(span: Span, tag?: string): readonly {
    day: Day;
    event: Event
}[] {
    const key = `${span}:${tag ?? ""}`;
    const kept = this.#cache.get(key);
    if (kept) return kept;
    const out: {
      day: Day;
      event: Event
  }[] = [];
    for (const event of this.#events.values()) {
      if (tag && !event.tags.has(tag)) continue;
      const wide = new Span(span.from.plus(1 - event.days), span.to);
      const starts = event.rule ? event.rule.in(event.start,
        wide) : wide.has(event.start) ? [event.start] : [];
      for (const s of starts) {
        this.expanded++;
        const inside = new Span(s, s.plus(event.days)).overlap(span);
        if (inside) for (const day of inside) out.push({ day, event });
      }
    }
    out.sort((a, b) => a.day.compare(b.day) || a.event.id - b.event.id);
    this.#cache.set(key, out);
    return out;
  }
  free(span: Span, length: number): Span[] {
    const busy = new Set(this.agenda(span).map(x => x.day.number));
    const out: Span[] = [];
    let from: Day | null = null;
    for (const d of span) {
      if (!busy.has(d.number)) from ??= d;
      else {
        if (from && from.until(d) >= length) out.push(new Span(from, d));
        from = null;
      }
    }
    if (from && from.until(span.to) >= length) out.push(new Span(from, span.to));
    return out;
  }
  month(y: number, m: number): string {
    const first = Day.ymd(y, m, 1), span = new Span(first, first.plusMonths(1));
    const marks = new Map<number, number>();
    for (const { day } of this.agenda(span)) marks.set(day.number,
      (marks.get(day.number) ?? 0) + 1);
    let out = `${MONTHS[m - 1]} ${y}\n${WEEKDAYS.map(w => w.slice(0, 2)).join("  ")}\n` + "    ".repeat(first.weekday);
    for (const d of span) {
      const n = marks.get(d.number);
      out += String(d.parts.d).padStart(2) + (n ? (n > 9 ? "+" : n) : " ") + (d.weekday === 6 ? "\n" : " ");
    }
    return out.trimEnd();
  }
}
for (const t of ["2026-11-12", "2024-02-29", "2000-12-31", "1970-01-01", "1969-12-31",
  "2027-01-01"]) {
  const d = Day.parse(t);
  console.log(String(d), d.number, WEEKDAYS[d.weekday], d.week.join("-w"),
    String(d.plusMonths(1)), String(d.plusMonths(-12)), JSON.stringify(d.parts));
}
console.log([2024, 2025, 2026, 2038].map(y => String(Day.easter(y))).join());
const start = Day.parse("2026-01-01");
for (const text of ["daily times 3", "every 3 days until 2026-01-10",
  "weekdays times 6 except 2026-01-05, 2026-01-06", "every 2 weeks on mon, thu times 5",
  "every month on 31 times 4", "every month on -1 times 3",
  "every month on second tue times 3", "every month on last fri times 3",
  "yearly on feb 29 times 2", "yearly on easter plus 1 times 3", "every sunday times 2",
  "every week on sat plus every month on 15 times 8"]) {
  const rule = new RuleParser(text).parse();
  const out: string[] = [];
  for (const d of rule.from(start)) {
    out.push(String(d).slice(5));
    if (out.length === 10) break;
  }
  console.log(text, "=>", String(rule), out.join(" "));
}
for (const bad of ["", "sometimes", "every x", "every month on", "every week mon",
  "daily until tomorrow", "daily times", "yearly on foo 3", "daily daily"]) try {
  console.log(bad, String(new RuleParser(bad).parse()));
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
const calendar = new Calendar();
calendar.add("standup", start, { rule: "weekdays except 2026-01-01", tags: ["work"] });
calendar.add("review", start.plus(8), { rule: "every 2 weeks on fri", tags: ["work", "long"] });
calendar.add("pay", start, { rule: "every month on -1", tags: ["money"] });
calendar.add("trip", Day.parse("2026-03-28"), { days: 9, tags: ["fun"] });
calendar.add("easter", start, { rule: "yearly on easter", days: 2, tags: ["fun"] });
calendar.add("rent", start, { rule: "every month on 3 until 2026-06-30", tags: ["money"] });
const year = new Span(start, start.plusMonths(12));
console.log(calendar.agenda(year).length, calendar.agenda(year,
  "money").map(x => String(x.day).slice(5) + x.event.title[0]).join(" "),
  calendar.free(new Span(start, start.plusMonths(4)), 2).slice(0, 4).join(" "));
console.log(calendar.month(2026, 4));
let mixed = 0;
for (let i = 0; i < 500; i++) {
  const from = start.plus((i * 17) % 300);
  const span = new Span(from, from.plus(20 + (i % 40)));
  if (i % 25 === 0) calendar.move(4, i % 2 ? -3 : 5);
  if (i % 60 === 1) calendar.add("extra" + i, from, { days: 1 + (i % 4),
    rule: i % 3 ? "every 11 days times 9" : null });
  mixed = (mixed * 31 + calendar.agenda(span).length + calendar.free(span,
    1 + (i % 3)).length + (calendar.agenda(span, "fun")[0]?.day.number ?? 7)) >>> 0;
}
console.log(mixed, calendar.expanded, calendar.remove(1), calendar.remove(1),
  calendar.agenda(year).length, Day.made);
for (const bad of [() => Day.ymd(2026, 2, 29), () => Day.parse("x"),
  () => new Span(start.plus(1), start), () => new Daily(0), () => new Weekly([]),
  () => calendar.move(999, 1)]) try {
  bad();
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
