interface Options {
  retries?: number;
  delay?: number;
  label?: string;
}
type Settled = Required<Options>;
type Loose<T> = { [K in keyof T]?: T[K] };
type Strict<T> = { [K in keyof T]-?: T[K] };

const defaults: Settled = { retries: 1, delay: 2, label: "none" };
const given: Options[] = [{ delay: 5 }, { label: "late" }, {}, { retries: undefined }, defaults];
const show = (name: string, o: Options) =>
  console.log(name, o.retries, o.delay, o.label, Object.keys(o).join(), "retries" in o, JSON.stringify(o));

function settle(options: Options): Settled {
  return { ...defaults, ...options } as Settled;
}
function cost(o: Settled): number {
  return o.retries * o.delay + o.label.length;
}
function costOfGiven(o: Options): number {
  return (o.retries ?? 3) * (o.delay ?? 4) + (o.label ?? "").length;
}

for (const o of given) {
  show("given", o);
  const settled = settle(o);
  show("settled", settled);
  console.log(costOfGiven(o), costOfGiven(settled), settled.retries === undefined ? "no number" : cost(settled));
}

const loose: Loose<Settled>[] = [{ delay: 7 }, defaults, given[1]];
for (const o of loose) show("loose", o);
const strict: Strict<Options>[] = [defaults, settle(given[0]), Object.assign({}, defaults, given[1])];
for (const o of strict) console.log(cost(o), JSON.stringify(o));

const draft: Options = {};
draft.label = "drawn";
draft.retries = 2;
draft.delay = 3;
show("filled in another order", draft);
console.log(cost(draft as Settled));

const fewer = { ...defaults } as Settled;
delete (fewer as Options).delay;
show("one is deleted", fewer);
console.log(cost(fewer), costOfGiven(fewer));

const named: (Settled & { name: string })[] = [{ name: "first", ...defaults, ...given[0] } as Settled & { name: string }];
const namedLoosely: (Options & { name: string })[] = [{ name: "second", delay: 9 }, named[0]];
for (const o of namedLoosely) console.log(o.name, costOfGiven(o), JSON.stringify(o));
console.log(cost(named[0]));

const parsed: Settled = JSON.parse('{"delay":4,"label":"read"}');
show("parsed", parsed);
console.log(cost(parsed), costOfGiven(parsed));
export {};
