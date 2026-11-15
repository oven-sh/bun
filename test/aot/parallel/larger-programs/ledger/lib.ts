// Accounts in several currencies, entries that balance, holds, interest, reports by period, events that are replayed, undo and redo by compensating entries
export type Currency = "EUR" | "USD" | "JPY";
export type AccountKind = "asset" | "liability" | "income" | "expense" | "equity";
export interface Leg {
  readonly account: string;
  readonly amount: Money
}
export class Money {
  static readonly #digits: Readonly<Record<Currency, number>> = {
    EUR: 2, USD: 2, JPY: 0
};
  private constructor(readonly units: bigint, readonly currency: Currency) {
  }
  static of(text: string | number, currency: Currency): Money {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(text));
    if (!m) throw new SyntaxError("bad amount " + text);
    const d = Money.#digits[currency], fraction = (m[3] ?? "").padEnd(d, "0");
    if (fraction.length > d) throw new RangeError(`${text} has too many digits for ${currency}`);
    const units = BigInt(m[2] + fraction);
    return new Money(m[1] ? -units : units, currency);
  }
  static zero(c: Currency) {
    return new Money(0n, c);
  }
  #same(o: Money) {
    if (o.currency !== this.currency) throw new TypeError(`${this.currency} and ${o.currency}`);
  }
  plus(o: Money) {
    this.#same(o);
    return new Money(this.units + o.units, this.currency);
  }
  minus(o: Money) {
    this.#same(o);
    return new Money(this.units - o.units, this.currency);
  }
  negate() {
    return new Money(-this.units, this.currency);
  }
  times(top: bigint, bottom = 1n) {
    const n = this.units * top;
    const half = bottom / 2n;
    return new Money(n >= 0n ? (n + half) / bottom : (n - half) / bottom, this.currency);
  }
  split(...parts: number[]): Money[] {
    const total = parts.reduce((a, b) => a + b, 0);
    let left = this.units;
    const out = parts.map(p => {
      const share = (this.units * BigInt(p)) / BigInt(total);
      left -= share;
      return share;
  });
    for (let i = 0; left !== 0n; i = (i + 1) % out.length) {
      out[i] += left > 0n ? 1n : -1n;
      left -= left > 0n ? 1n : -1n;
    }
    return out.map(u => new Money(u, this.currency));
  }
  convert(to: Currency, top: bigint, bottom: bigint) {
    const shift = Money.#digits[to] - Money.#digits[this.currency];
    const scaled = shift >= 0 ? this.units * 10n ** BigInt(shift) : this.units;
    const m = new Money(scaled, to).times(top, bottom);
    return shift < 0 ? m.times(1n, 10n ** BigInt(-shift)) : m;
  }
  compare(o: Money) {
    this.#same(o);
    return this.units < o.units ? -1 : this.units > o.units ? 1 : 0;
  }
  get isNegative() {
    return this.units < 0n;
  }
  get isZero() {
    return this.units === 0n;
  }
  toString() {
    const d = Money.#digits[this.currency],
      t = (this.units < 0n ? -this.units : this.units).toString().padStart(d + 1, "0");
    return `${this.units < 0n ? "-" : ""}${d ? t.slice(0, -d) + "." + t.slice(-d) : t} ${this.currency}`;
  }
  toJSON() {
    return String(this);
  }
  static parse(text: string) {
    const [n, c] = text.split(" ");
    return Money.of(n, c as Currency);
  }
}
export class LedgerError extends Error {
  constructor(readonly code: "unbalanced" | "unknown" | "overdrawn" | "closed" | "hold" | "nothing",
    message: string) {
    super(message);
    this.name = "LedgerError";
  }
}
export abstract class Account {
  #balance: Money;
  #closed = false;
  readonly holds = new Map<string, Money>();
  entries = 0;
  constructor(readonly name: string, readonly kind: AccountKind, readonly currency: Currency) {
    this.#balance = Money.zero(currency);
  }
  get balance() {
    return this.#balance;
  }
  get held() {
    let sum = Money.zero(this.currency);
    for (const h of this.holds.values()) sum = sum.plus(h);
    return sum;
  }
  get available() {
    return this.#balance.minus(this.held);
  }
  get closed() {
    return this.#closed;
  }
  close() {
    if (!this.#balance.isZero) throw new LedgerError("closed",
      `${this.name} still has ${this.#balance}`);
    this.#closed = true;
  }
  abstract mayApply(amount: Money): boolean;
  apply(amount: Money, force = false) {
    if (this.#closed) throw new LedgerError("closed", this.name + " is closed");
    if (!force && !this.mayApply(amount)) throw new LedgerError("overdrawn",
      `${this.name} has ${this.available}, needs ${amount.negate()}`);
    this.#balance = this.#balance.plus(amount);
    this.entries++;
  }
  get sign() {
    return this.kind === "asset" || this.kind === "expense" ? 1 : -1;
  }
}
export class Plain extends Account {
  mayApply(amount: Money) {
    return this.kind !== "asset" || !amount.isNegative ||
      !this.available.plus(amount).isNegative;
  }
}
export class Credit extends Account {
  constructor(name: string, currency: Currency, readonly limit: Money) {
    super(name, "asset", currency);
  }
  mayApply(amount: Money) {
    return this.available.plus(amount).plus(this.limit).units >= 0n;
  }
}
export class Savings extends Plain {
  accrued = 0;
  constructor(name: string, currency: Currency, readonly rate: bigint) {
    super(name, "asset", currency);
  }
  interest(): Money {
    this.accrued++;
    return this.balance.times(this.rate, 10000n);
  }
}
export type Event = {
  type: "open";
  id: number;
  at: number;
  name: string;
  kind: AccountKind | "credit" | "savings";
  currency: Currency;
  extra?: string
} | {
  type: "post";
  id: number;
  at: number;
  memo: string;
  legs: {
    account: string;
    amount: string
}[];
  reverses?: number
} | {
  type: "hold";
  id: number;
  at: number;
  key: string;
  account: string;
  amount: string
} | {
  type: "release";
  id: number;
  at: number;
  key: string;
  account: string
} | {
  type: "close";
  id: number;
  at: number;
  name: string
};
export interface Entry {
  readonly id: number;
  readonly at: number;
  readonly memo: string;
  readonly legs: readonly Leg[];
  readonly reverses?: number;
  reversedBy?: number
}
export class Ledger {
  readonly accounts = new Map<string, Account>();
  readonly entries: Entry[] = [];
  readonly events: Event[] = [];
  readonly #undo: number[] = [];
  readonly #redo: number[] = [];
  #next = 1;
  clock = 0;
  replaying = false;
  constructor(readonly name: string) {
  }
  #id() {
    return this.#next++;
  }
  account(name: string): Account {
    const a = this.accounts.get(name);
    if (!a) throw new LedgerError("unknown", "no account " + name);
    return a;
  }
  open(name: string, kind: AccountKind | "credit" | "savings", currency: Currency,
    extra = "0"): Account {
    if (this.accounts.has(name)) throw new LedgerError("unknown", name + " exists");
    const a = kind === "credit" ? new Credit(name, currency, Money.of(extra,
      currency)) : kind === "savings" ? new Savings(name, currency,
      BigInt(extra)) : new Plain(name, kind, currency);
    this.accounts.set(name, a);
    this.#record({ type: "open", id: this.#id(), at: this.clock, name, kind, currency, extra });
    return a;
  }
  #record(e: Event) {
    if (!this.replaying) this.events.push(e);
  }
  post(memo: string, ...legs: [account: string, amount: string | Money][]): Entry {
    return this.#post(memo, legs.map(([name, m]) => {
      const a = this.account(name);
      return {
        account: name, amount: typeof m === "string" ? Money.of(m, a.currency) : m
    };
  }));
  }
  #post(memo: string, legs: Leg[], reverses?: number): Entry {
    const sums = new Map<Currency, bigint>();
    for (const l of legs) sums.set(l.amount.currency,
      (sums.get(l.amount.currency) ?? 0n) + l.amount.units);
    for (const [c, n] of sums) if (n !== 0n) throw new LedgerError("unbalanced",
      `${memo}: ${c} is off by ${n}`);
    const done: Leg[] = [];
    try {
      for (const l of legs) {
        this.account(l.account).apply(l.amount, reverses !== undefined);
        done.push(l);
      }
  } catch (e) {
      for (const l of done.reverse()) {
        const a = this.account(l.account);
        a.apply(l.amount.negate(), true);
        a.entries -= 2;
      }
      throw e;
    }
    const entry: Entry = {
      id: this.#id(), at: this.clock, memo, legs, reverses
  };
    this.entries.push(entry);
    this.#record({ type: "post", id: entry.id, at: entry.at, memo,
      legs: legs.map(l => ({ account: l.account, amount: String(l.amount) })), reverses });
    if (reverses === undefined) {
      this.#undo.push(entry.id);
      this.#redo.length = 0;
    }
    return entry;
  }
  #reverse(id: number, memo: string): Entry {
    const e = this.entries.find(x => x.id === id)!;
    const back = this.#post(memo, e.legs.map(l => ({ account: l.account,
      amount: l.amount.negate() })), id);
    e.reversedBy = back.id;
    return back;
  }
  undo(): Entry {
    const id = this.#undo.pop();
    if (id === undefined) throw new LedgerError("nothing", "nothing to undo");
    const back = this.#reverse(id, "undo");
    this.#redo.push(back.id);
    return back;
  }
  redo(): Entry {
    const id = this.#redo.pop();
    if (id === undefined) throw new LedgerError("nothing", "nothing to redo");
    const again = this.#reverse(id, "redo");
    this.#undo.push(again.id);
    return again;
  }
  hold(key: string, name: string, amount: string) {
    const a = this.account(name), m = Money.of(amount, a.currency);
    if (a.available.compare(m) < 0) throw new LedgerError("hold",
      `cannot hold ${m} of ${a.available}`);
    a.holds.set(key, m);
    this.#record({ type: "hold", id: this.#id(), at: this.clock, key, account: name,
      amount: String(m) });
  }
  release(key: string, name: string, pay?: string) {
    const a = this.account(name), m = a.holds.get(key);
    if (!m) throw new LedgerError("hold", "no hold " + key);
    a.holds.delete(key);
    this.#record({ type: "release", id: this.#id(), at: this.clock, key, account: name });
    if (pay) this.post("held " + key, [name, m.negate()], [pay, m]);
  }
  close(name: string) {
    this.account(name).close();
    this.#record({ type: "close", id: this.#id(), at: this.clock, name });
  }
  accrue(from: string) {
    for (const a of this.accounts.values()) if (a instanceof Savings && !a.balance.isZero) {
      const i = a.interest();
      if (!i.isZero) this.post("interest", [from, i.negate()], [a.name, i]);
    }
  }
  static replay(name: string, events: readonly Event[]): Ledger {
    const l = new Ledger(name);
    l.replaying = true;
    for (const e of events) {
      l.clock = e.at;
      switch (e.type) {
        case "open": l.open(e.name, e.kind, e.currency, e.extra);
        break;
        case "post": {
          const entry = l.#post(e.memo, e.legs.map(x => ({ account: x.account,
            amount: Money.parse(x.amount) })), e.reverses);
          if (e.reverses !== undefined) l.entries.find(x => x.id === e.reverses)!.reversedBy = entry.id;
          break;
        }
        case "hold": {
          const a = l.account(e.account);
          a.holds.set(e.key, Money.parse(e.amount));
          l.#id();
          break;
        }
        case "release": l.account(e.account).holds.delete(e.key);
        l.#id();
        break;
        case "close": l.account(e.name).close();
        l.#id();
        break;
        default: {
          const never: never = e;
          throw new TypeError(String(never));
        }
      }
    }
    l.replaying = false;
    return l;
  }
  report(from = 0, to = Infinity): Record<string, string> {
    const sums = new Map<string, Money>();
    for (const e of this.entries) {
      if (e.at < from || e.at >= to || e.reversedBy !== undefined ||
        e.reverses !== undefined) continue;
      for (const l of e.legs) sums.set(l.account,
        (sums.get(l.account) ?? Money.zero(l.amount.currency)).plus(l.amount));
    }
    return Object.fromEntries([...sums].sort(([a], [b]) => (a < b ? -1 : 1)).map(([n,
      m]) => [n, String(m)]));
  }
  trial(): string {
    const sums = new Map<Currency, Money>();
    for (const a of this.accounts.values()) sums.set(a.currency,
      (sums.get(a.currency) ?? Money.zero(a.currency)).plus(a.balance));
    return [...sums.values()].join(" ");
  }
}
