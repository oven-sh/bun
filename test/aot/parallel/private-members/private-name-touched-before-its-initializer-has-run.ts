// A base constructor calls an overridden method that touches #x before the initializer of #x has run: TypeError.
class Base { seen: string[] = []; constructor() { this.seen.push(this.look()); } look(): string { return "base"; } }
class Derived extends Base {
  #x = 7;
  look(): string { try { return "read " + this.#x; } catch (e: any) { return "read throws " + (e instanceof TypeError); } }
  later() { return this.#x; }
}
class Storing extends Base {
  #x = 7;
  look(): string { try { this.#x = 9; return "stored"; } catch (e: any) { return "store throws " + (e instanceof TypeError); } }
  later() { return this.#x; }
}
class Asking extends Base {
  #x = 7;
  look(): string { return "has " + (#x in this); }
  later() { return #x in this; }
}
class Calling extends Base {
  #m() { return 1; }
  get #g() { return 2; }
  look(): string { try { return "call " + this.#m() + this.#g; } catch (e: any) { return "call throws " + (e instanceof TypeError); } }
  later() { return this.#m() + this.#g; }
}
class InOrder { #a = this.peek(); #b = 2; peek(): string { try { return "b is " + this.#b; } catch (e: any) { return "b throws " + (e instanceof TypeError); } } a() { return this.#a; } }
for (let round = 0; round < 3; round++) {
  const d = new Derived(), s = new Storing(), q = new Asking(), c = new Calling();
  console.log(d.seen.join(), d.later(), d.look());
  console.log(s.seen.join(), s.later(), s.look(), s.later());
  console.log(q.seen.join(), q.later(), q.look());
  console.log(c.seen.join(), c.later(), c.look());
  console.log(new InOrder().a(), new InOrder().peek());
}
