interface O {
  a: number;
  b: number;
  c: number;
}
const full: O = { a: 1, b: 2, c: 3 };
const some: Partial<O>[] = [{ b: 5 }, { c: 6 }, {}, { a: undefined }, full];
const show = (name: string, o: Partial<O>) => console.log(name, o.a, o.b, o.c, Object.keys(o).join(), "a" in o, JSON.stringify(o));

function sumOfGiven(o: Partial<O>): number {
  return (o.a ?? 10) + (o.b ?? 20) + (o.c ?? 30);
}
function sumOfAll(o: O): number {
  return o.a + o.b + o.c;
}

for (const o of some) {
  show("as given", o);
  console.log(sumOfGiven(o));
}
console.log(sumOfGiven(full), sumOfAll(full));

const merged: O[] = some.map(o => ({ ...full, ...o }) as O);
for (const o of merged) {
  show("merged", o);
  console.log(sumOfGiven(o), sumOfAll(o));
}
const assigned: O[] = some.map(o => Object.assign({}, full, o) as O);
for (const o of assigned) show("assigned", o);

const lied = { b: 7 } as O;
show("lied", lied);
console.log(sumOfAll(lied), sumOfGiven(lied));

const shrunk: O = { ...full };
delete (shrunk as Partial<O>).b;
show("deleted", shrunk);
console.log(sumOfAll(shrunk), sumOfGiven(shrunk));

const grown: Partial<O> = {};
grown.c = 1;
grown.a = 2;
show("filled later", grown);
const required = grown as Required<O>;
required.b = 3;
show("filled through the other type", grown);
console.log(sumOfAll(required));

const box: { held: Partial<O> } = { held: full };
box.held = { c: 9 };
show("in a box", box.held);
const list: O[] = [full];
(list as Partial<O>[]).push({ b: 1 });
for (const o of list) console.log(sumOfAll(o), o.b);

class Options implements O {
  a = 1;
  b = 2;
  c = 3;
}
show("instance", new Options());
console.log(sumOfGiven(new Options()), sumOfAll(new Options()), JSON.stringify({ ...new Options(), ...some[0] }));

interface Maybe {
  a?: number | string;
  b?: number;
  c?: number;
}
const wider: Maybe = { a: "text" };
show("wider", wider as Partial<O>);
console.log(sumOfGiven(wider as Partial<O>), JSON.stringify({ ...full, ...wider }));

const parsed: O = JSON.parse('{"a":4,"c":5}');
show("parsed", parsed);
console.log(sumOfAll(parsed), sumOfGiven(parsed));
export {};
