// Objects with declared types, handed to the addon, which stores values of the declared kinds: typed code reads them back from slots.
interface Attack {
  store(o: object, key: string | number | symbol, value: unknown): string;
  storeNamed(o: object, name: string, value: unknown): string;
  storeElement(o: object, index: number, value: unknown): string;
  storeInto(o: object, via: string | number, key: string | number, value: unknown): string;
  storeIntoKept(index: number, key: string, value: unknown): string;
  storeIntoGlobal(name: string, key: string, value: unknown): string;
  removeKey(o: object, key: string): boolean | string;
  keep(index: number, value: unknown): string;
  callKept(index: number, ...values: unknown[]): unknown;
  call(self: unknown, f: Function, ...values: unknown[]): unknown;
  construct(C: Function, ...values: unknown[]): unknown;
  freeze(o: object): string;
}
const loaded: { exports: Attack } = { exports: {} as Attack };
process.dlopen(loaded, process.env.ADDON!);
const attack = loaded.exports;
let at = 0;
function row(label: string, f: () => unknown): void {
  let said: string;
  try {
    said = JSON.stringify(f());
  } catch (error) {
    said = "threw " + (error as Error).constructor.name;
  }
  console.log(String(++at).padStart(3) + " " + label + ": " + said);
}

class Account {
  balance: number;
  owner: string;
  open: boolean = true;
  note?: string;
  history: number[] = [];
  constructor(owner: string, balance: number) {
    this.owner = owner;
    this.balance = balance;
  }
  worth(): number {
    return this.balance + this.history.length;
  }
}
interface Settings {
  depth: number;
  label: string;
  inner: { limit: number };
  tags: string[];
}
function total(account: Account): number {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += account.balance + account.owner.length + (account.open ? 1 : 0) + account.worth();
  return sum;
}
function look(account: Account): unknown[] {
  return [total(account), account.note ?? "none", JSON.stringify(account)];
}
function read(settings: Settings): number {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += settings.depth + settings.label.length + settings.inner.limit + settings.tags.length;
  return sum;
}
const make = (): Account => new Account("ann", 10);
const makeSettings = (): Settings => ({ depth: 1, label: "one", inner: { limit: 2 }, tags: ["a"] });

row("untouched", () => [look(make()), read(makeSettings())]);
row("an integer", () => { const a = make(); return [attack.store(a, "balance", 20), look(a)]; });
row("a fraction", () => { const a = make(); return [attack.store(a, "balance", 0.25), look(a)]; });
row("a large number", () => { const a = make(); return [attack.store(a, "balance", 2 ** 40), look(a)]; });
row("NaN and -0", () => { const a = make(); const b = make(); attack.store(a, "balance", NaN); attack.store(b, "balance", -0); return [String(total(a)), Object.is(b.balance, -0), total(b)]; });
row("a string", () => { const a = make(); return [attack.storeNamed(a, "owner", "beatrice"), look(a)]; });
row("a boolean", () => { const a = make(); return [attack.store(a, "open", false), look(a)]; });
row("an optional field is filled", () => { const a = make(); return [attack.store(a, "note", "hello"), look(a)]; });
row("an optional field is removed", () => { const a = make(); a.note = "x"; return [attack.removeKey(a, "note"), look(a), "note" in a]; });
row("an array is replaced", () => { const a = make(); return [attack.store(a, "history", [1, 2, 3]), look(a)]; });
row("an array is changed", () => { const a = make(); return [attack.storeInto(a, "history", 0, 5), attack.storeInto(a, "history", 1, 6.5), look(a)]; });
row("changed inside the loop", () => { const a = make(); let sum = 0; for (let round = 0; round < 50; round++) { sum += a.balance; attack.store(a, "balance", round); sum += a.balance + a.worth(); } return sum; });
row("changed inside the loop, not handed in that call", () => { const a = make(); attack.keep(0, a); let sum = 0; for (let round = 0; round < 50; round++) { sum += a.balance; attack.storeIntoKept(0, "balance", round * 0.5); sum += a.balance; } return sum; });
row("a typed method called by the addon", () => { const a = make(); return [attack.call(a, a.worth), attack.call(a, Account.prototype.worth)]; });
row("made by the addon", () => { const a = attack.construct(Account, "cy", 3) as Account; return [look(a), a instanceof Account]; });
row("frozen, then typed code stores", () => { const a = make(); attack.freeze(a); a.balance = 1; return a.balance; });
row("a literal with a declared type", () => { const s = makeSettings(); return [attack.store(s, "depth", 5), attack.store(s, "label", "longer"), attack.storeInto(s, "inner", "limit", 7), attack.storeInto(s, "tags", 1, "b"), read(s), JSON.stringify(s)]; });
row("a literal's inner object is replaced", () => { const s = makeSettings(); return [attack.store(s, "inner", { limit: 70 }), attack.store(s, "tags", ["x", "y", "z"]), read(s)]; });
row("a typed closure kept and called later", () => { let sum = 0; const add = (n: number): number => (sum += n); attack.keep(1, add); let seen = 0; for (let round = 0; round < 50; round++) { seen += sum; attack.callKept(1, round); } return [seen, sum]; });
(globalThis as { account?: Account }).account = make();
const reached = (globalThis as { account?: Account }).account!;
row("found by a global", () => [attack.storeIntoGlobal("account", "balance", 99), look(reached)]);
export {};
