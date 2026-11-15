// list = []; list.push(...rest) keeps the list that gathers the arguments, where nothing else uses it.
// STATISTIC: RestListsUsedAsLiterals >= 3
"use strict";
class Wallet {
  static #count = 0;
  #coins = [];
  constructor(...coins) { Wallet.#count++; this.#coins.push(...coins); }
  add(...more) { return this.#coins.push(...more); }
  take() { return this.#coins.pop(); }
  get list() { return this.#coins; }
  static get count() { return Wallet.#count; }
}
class Plain {
  constructor(name, ...items) { this.name = name; this.items = []; this.items.push(...items); this.items.push({ name }); }
}
class Derived extends Plain {
  constructor(...all) { super("derived", ...all); this.own = []; this.own.push(all.length); }
}
function gather(...xs) { const list = []; list.push(...xs); list.push("end"); return list; }
function answer(...xs) { const list = []; const length = list.push(...xs); return [length, list]; }
function measured(...xs) { const list = []; const before = list.length; list.push(...xs); return [before, list.length, list]; }
function first(...xs) { const list = []; list.push(0); list.push(...xs); return list; }
function twice(...xs) { const list = [], other = []; list.push(...xs); other.push(...xs); other.push("other"); return [list, other]; }
function inLoop(...xs) { const out = []; for (let k = 0; k < 3; k++) { const list = []; list.push(...xs); list.push(k); out.push(list); } return out; }
function inBranch(taken, ...xs) { const list = []; if (taken) list.push(...xs); list.push("b"); return list; }
function caught(throws, ...xs) { const list = []; try { if (throws) throw new Error("early"); list.push(...xs); } catch (error) { list.push(error.message); } list.push("c"); return list; }
function thrown(thrower, ...xs) { const list = []; try { thrower(); list.push(...xs); } catch { } return list; }
function called(callback, ...xs) { const list = []; callback(list); list.push(...xs); return list; }
function interposed(hook, ...xs) { const list = []; hook(); list.push(...xs); return list; }
function branched(taken, ...xs) { const list = []; if (taken) { list.push(...xs); return list; } return ["not taken", list]; }
function outer(...xs) { const inner = gather(...xs); xs.push("outer"); return [inner, xs]; }
function forwarded(...xs) { return gather(...xs); }
function* generated(...xs) { const list = []; list.push(...xs); yield list; list.push("later"); yield list; }
async function awaited(...xs) { const list = []; list.push(...xs); await null; list.push("awaited"); return list; }
const arrow = (...xs) => { const list = []; list.push(...xs); return list; };
function withArguments(...xs) { const list = []; list.push(...xs); list.push(arguments.length); return [list, arguments[0]]; }
const show = (value) => Array.isArray(value) ? "[" + Array.from(value, (item, k) => (k in value ? "" : "hole ") + show(item)).join() + "]" : Object.is(value, -0) ? "-0" : value && typeof value === "object" ? "{" + Object.keys(value).map((key) => key + ":" + show(value[key])).join() + "}" : typeof value + " " + String(value);
function* counts() { yield 1; yield 2; }
async function main() {
  const kept = [];
  for (let k = 0; k < 200; k++) {
    const source = [k, k + 1, k * 2], words = ["a" + k, null, undefined], halves = [k / 2, -0, NaN], holes = [k, , 3];
    const wallets = [new Wallet(1, 2, k), new Wallet(), new Wallet(k / 2), new Wallet(...source), new Wallet(...words), new Wallet(...holes), new Wallet(...halves), Reflect.construct(Wallet, source), new (Wallet.bind(null, "bound"))(k), new Wallet(...counts())];
    for (const wallet of wallets) { wallet.add(k, "x", 0.5); wallet.take(); wallet.list.extra = k; }
    kept.push(wallets[k % 10], new Plain("n", { k }, [k]), gather({ k }));
    if (kept.length > 60) kept.splice(0, 30);
    if (k % 40) continue;
    console.log(wallets.map((wallet) => show(wallet.list)).join(" "), Wallet.count);
    console.log(show(source), show(words), show(halves), show(holes), show(Object.keys(source)));
    console.log(show(new Plain("p")), show(new Plain("p", 1, 2)), show(new Derived(k, "d")), show(new Derived()));
    console.log(show(gather()), show(gather(...source)), show(gather.apply(null, source)), show(gather.call(null, 0.5, "s")), show(Reflect.apply(gather, null, words)), show(answer()), show(answer(k, 1)), show(measured(1, 2)), show(first(...halves)));
    console.log(show(twice(1, k)), show(inLoop(k, "l")), show(inBranch(true, k)), show(inBranch(false, k)), show(caught(true, k)), show(caught(false, k)));
    console.log(show(thrown(() => { throw 1; }, k)), show(thrown(() => k, k)), show(called((list) => list.push("early"), k)), show(called((list) => { list.length = 2; }, k)), show(interposed(() => k, k, "i")), show(branched(true, k)), show(branched(false, k)), show(outer(k, "o")), show(forwarded(...source)), show(withArguments(k, 2)));
    console.log(show([...generated(1, k)]), show(await awaited(k, "w")), show(arrow(k)), show([source].map((list) => arrow(...list))), show([1, 2].map(arrow)));
    const long = Array.from({ length: 3000 }, (_, index) => index);
    console.log(gather(...long).length, new Wallet(...long).list.length, answer(...long)[0], source.length);
  }
  console.log(show(kept.slice(0, 12).map((item) => item instanceof Wallet ? item.list : item)));
}
main();
