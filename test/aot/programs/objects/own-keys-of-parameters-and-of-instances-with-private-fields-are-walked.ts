// Own keys are walked: spreads, Object.assign, Object.values, for..in, over objects whose layouts are known.
interface Point { a: number; b: number }

function spreadOfParameter(o: Point): { a: number; b: number; c: number } {
  return { ...o, c: 1 };
}

function assignOfParameter(o: Point): Point {
  return Object.assign({}, o);
}

function valuesOfParameter(o: Point): number {
  const v = Object.values(o);
  return v[0] + v[1];
}

class WithPrivate {
  #p = 1;
  a = 2;
  b = 3;
  bump(): void { this.#p++; }
  get p(): number { return this.#p; }
}

class WithoutPrivate {
  p = 1;
  a = 2;
  b = 3;
}

function spreadOfPrivate(c: WithPrivate): number {
  const copy = { ...c };
  return copy.a + copy.b;
}

function valuesOfPrivate(c: WithPrivate): number {
  const v = Object.values(c);
  return v.length + v[0];
}

function namesOfPrivate(c: WithPrivate): number {
  let n = 0;
  for (const k in c) n += k.length;
  return n;
}

function spreadOfPublic(c: WithoutPrivate): number {
  const copy = { ...c };
  return copy.a + copy.b;
}

function valuesOfPublic(c: WithoutPrivate): number {
  const v = Object.values(c);
  return v.length + v[0];
}

function namesOfPublic(c: WithoutPrivate): number {
  let n = 0;
  for (const k in c) n += k.length;
  return n;
}

const points: Point[] = [];
for (let i = 0; i < 8; i++) points.push({ a: i, b: i + 1 });
const privates: WithPrivate[] = [];
const publics: WithoutPrivate[] = [];
for (let i = 0; i < 8; i++) {
  privates.push(new WithPrivate());
  publics.push(new WithoutPrivate());
}

let sum = 0;
for (let i = 0; i < 200000; i++) {
  const o = points[i & 7];
  sum += spreadOfParameter(o).c + spreadOfParameter(o).b;
  sum += assignOfParameter(o).a;
  sum += valuesOfParameter(o);
  const c = privates[i & 7];
  c.bump();
  sum += spreadOfPrivate(c) + valuesOfPrivate(c) + namesOfPrivate(c) + (c.p & 1);
  const d = publics[i & 7];
  sum += spreadOfPublic(d) + valuesOfPublic(d) + namesOfPublic(d);
  sum %= 1000003;
}
console.log(sum);
