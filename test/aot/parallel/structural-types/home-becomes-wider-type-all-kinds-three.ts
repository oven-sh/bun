// A home becomes a wider type at every kind of conversion part three.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

const yes = [1].length === 1;
function touch(): void {}

class A24 {
  name = "a24";
}
class D24 extends A24 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C24 extends A24 {
  lives = "nine";
}
class S24 {
  street = "main";
  pet: D24 = new D24();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T24 = { pet: A24 };
function honest24(): T24 {
  return { pet: new A24() };
}
function adopt24(t: T24): void {
  t.pet = new C24();
}
function legs24(home: S24): number {
  return home.pet.legs + 1;
}
function via24(s: S24): T24 {
  const map = new Map<string, T24>([["k", s]]);
  return map.get("k") ?? honest24();
}

class A25 {
  name = "a25";
}
class D25 extends A25 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C25 extends A25 {
  lives = "nine";
}
class S25 {
  street = "main";
  pet: D25 = new D25();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T25 = { pet: A25 };
function honest25(): T25 {
  return { pet: new A25() };
}
function adopt25(t: T25): void {
  t.pet = new C25();
}
function legs25(home: S25): number {
  return home.pet.legs + 1;
}
function via25(s: S25): T25 {
  const set = new Set<T25>();
  set.add(s);
  for (const t of set) return t;
  return honest25();
}

class A26 {
  name = "a26";
}
class D26 extends A26 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C26 extends A26 {
  lives = "nine";
}
class S26 {
  street = "main";
  pet: D26 = new D26();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T26 = { pet: A26 };
function honest26(): T26 {
  return { pet: new A26() };
}
function adopt26(t: T26): void {
  t.pet = new C26();
}
function legs26(home: S26): number {
  return home.pet.legs + 1;
}
function via26(s: S26): T26 {
  function* give(): Generator<T26> {
    yield s;
  }
  for (const t of give()) return t;
  return honest26();
}

class A27 {
  name = "a27";
}
class D27 extends A27 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C27 extends A27 {
  lives = "nine";
}
class S27 {
  street = "main";
  pet: D27 = new D27();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T27 = { pet: A27 };
function honest27(): T27 {
  return { pet: new A27() };
}
function adopt27(t: T27): void {
  t.pet = new C27();
}
function legs27(home: S27): number {
  return home.pet.legs + 1;
}
function via27(s: S27): T27 {
  const seen: T27[] = [];
  function* take(): Generator<undefined, void, T27> {
    seen.push(yield);
  }
  const generator = take();
  generator.next(honest27());
  generator.next(s);
  return seen[0];
}

class A28 {
  name = "a28";
}
class D28 extends A28 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C28 extends A28 {
  lives = "nine";
}
class S28 {
  street = "main";
  pet: D28 = new D28();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T28 = { pet: A28 };
function honest28(): T28 {
  return { pet: new A28() };
}
function adopt28(t: T28): void {
  t.pet = new C28();
}
function legs28(home: S28): number {
  return home.pet.legs + 1;
}
async function via28(s: S28): Promise<T28> {
  return s;
}

class A29 {
  name = "a29";
}
class D29 extends A29 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C29 extends A29 {
  lives = "nine";
}
class S29 {
  street = "main";
  pet: D29 = new D29();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T29 = { pet: A29 };
function honest29(): T29 {
  return { pet: new A29() };
}
function adopt29(t: T29): void {
  t.pet = new C29();
}
function legs29(home: S29): number {
  return home.pet.legs + 1;
}
function via29(s: S29): Promise<T29> {
  return Promise.resolve<T29>(s);
}

class A30 {
  name = "a30";
}
class D30 extends A30 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C30 extends A30 {
  lives = "nine";
}
class S30 {
  street = "main";
  pet: D30 = new D30();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T30 = { pet: A30 };
function honest30(): T30 {
  return { pet: new A30() };
}
function adopt30(t: T30): void {
  t.pet = new C30();
}
function legs30(home: S30): number {
  return home.pet.legs + 1;
}
function via30(s: S30): Promise<T30> {
  return Promise.resolve(0).then((): T30 => s);
}

class A31 {
  name = "a31";
}
class D31 extends A31 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C31 extends A31 {
  lives = "nine";
}
class S31 {
  street = "main";
  pet: D31 = new D31();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T31 = { pet: A31 };
function honest31(): T31 {
  return { pet: new A31() };
}
function adopt31(t: T31): void {
  t.pet = new C31();
}
function legs31(home: S31): number {
  return home.pet.legs + 1;
}
function via31(s: S31): Promise<T31> {
  return new Promise<T31>(resolve => resolve(s));
}

class A32 {
  name = "a32";
}
class D32 extends A32 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C32 extends A32 {
  lives = "nine";
}
class S32 {
  street = "main";
  pet: D32 = new D32();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T32 = { pet: A32 };
function honest32(): T32 {
  return { pet: new A32() };
}
function adopt32(t: T32): void {
  t.pet = new C32();
}
function legs32(home: S32): number {
  return home.pet.legs + 1;
}
function via32(s: S32): T32 {
  return [0].map((): T32 => s)[0];
}

class A33 {
  name = "a33";
}
class D33 extends A33 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C33 extends A33 {
  lives = "nine";
}
class S33 {
  street = "main";
  pet: D33 = new D33();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T33 = { pet: A33 };
function honest33(): T33 {
  return { pet: new A33() };
}
function adopt33(t: T33): void {
  t.pet = new C33();
}
function legs33(home: S33): number {
  return home.pet.legs + 1;
}
function same33<X>(x: X): X {
  return x;
}
function via33(s: S33): T33 {
  return same33<T33>(s);
}

class A34 {
  name = "a34";
}
class D34 extends A34 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C34 extends A34 {
  lives = "nine";
}
class S34 {
  street = "main";
  pet: D34 = new D34();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T34 = { pet: A34 };
function honest34(): T34 {
  return { pet: new A34() };
}
function adopt34(t: T34): void {
  t.pet = new C34();
}
function legs34(home: S34): number {
  return home.pet.legs + 1;
}
function widen34<X extends T34>(x: X): T34 {
  return x;
}
function via34(s: S34): T34 {
  return widen34(s);
}

class A35 {
  name = "a35";
}
class D35 extends A35 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C35 extends A35 {
  lives = "nine";
}
class S35 {
  street = "main";
  pet: D35 = new D35();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T35 = { pet: A35 };
function honest35(): T35 {
  return { pet: new A35() };
}
function adopt35(t: T35): void {
  t.pet = new C35();
}
function legs35(home: S35): number {
  return home.pet.legs + 1;
}
function via35(s: S35): T35 {
  let t: T35 = honest35();
  for (t of [s]);
  return t;
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  const home = new S24();
  adopt24(honest24());
  warm += legs24(home) + home.legs();
}
{
  const home = new S24();
  const t = await via24(home);
  attempt("the entries a map is made from: the same object", () => t === home);
  adopt24(t);
  attempt("the entries a map is made from: legs + 1", () => legs24(home));
  attempt("the entries a map is made from: its own method", () => home.legs());
  attempt("the entries a map is made from: bark", () => home.pet.bark());
  attempt("the entries a map is made from: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S25();
  adopt25(honest25());
  warm += legs25(home) + home.legs();
}
{
  const home = new S25();
  const t = await via25(home);
  attempt("a member of a set: the same object", () => t === home);
  adopt25(t);
  attempt("a member of a set: legs + 1", () => legs25(home));
  attempt("a member of a set: its own method", () => home.legs());
  attempt("a member of a set: bark", () => home.pet.bark());
  attempt("a member of a set: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S26();
  adopt26(honest26());
  warm += legs26(home) + home.legs();
}
{
  const home = new S26();
  const t = await via26(home);
  attempt("yield: the same object", () => t === home);
  adopt26(t);
  attempt("yield: legs + 1", () => legs26(home));
  attempt("yield: its own method", () => home.legs());
  attempt("yield: bark", () => home.pet.bark());
  attempt("yield: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S27();
  adopt27(honest27());
  warm += legs27(home) + home.legs();
}
{
  const home = new S27();
  const t = await via27(home);
  attempt("the value sent into a generator: the same object", () => t === home);
  adopt27(t);
  attempt("the value sent into a generator: legs + 1", () => legs27(home));
  attempt("the value sent into a generator: its own method", () => home.legs());
  attempt("the value sent into a generator: bark", () => home.pet.bark());
  attempt("the value sent into a generator: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S28();
  adopt28(honest28());
  warm += legs28(home) + home.legs();
}
{
  const home = new S28();
  const t = await via28(home);
  attempt("the result of an async function: the same object", () => t === home);
  adopt28(t);
  attempt("the result of an async function: legs + 1", () => legs28(home));
  attempt("the result of an async function: its own method", () => home.legs());
  attempt("the result of an async function: bark", () => home.pet.bark());
  attempt("the result of an async function: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S29();
  adopt29(honest29());
  warm += legs29(home) + home.legs();
}
{
  const home = new S29();
  const t = await via29(home);
  attempt("Promise.resolve: the same object", () => t === home);
  adopt29(t);
  attempt("Promise.resolve: legs + 1", () => legs29(home));
  attempt("Promise.resolve: its own method", () => home.legs());
  attempt("Promise.resolve: bark", () => home.pet.bark());
  attempt("Promise.resolve: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S30();
  adopt30(honest30());
  warm += legs30(home) + home.legs();
}
{
  const home = new S30();
  const t = await via30(home);
  attempt("the result of a reaction: the same object", () => t === home);
  adopt30(t);
  attempt("the result of a reaction: legs + 1", () => legs30(home));
  attempt("the result of a reaction: its own method", () => home.legs());
  attempt("the result of a reaction: bark", () => home.pet.bark());
  attempt("the result of a reaction: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S31();
  adopt31(honest31());
  warm += legs31(home) + home.legs();
}
{
  const home = new S31();
  const t = await via31(home);
  attempt("the resolver of a promise: the same object", () => t === home);
  adopt31(t);
  attempt("the resolver of a promise: legs + 1", () => legs31(home));
  attempt("the resolver of a promise: its own method", () => home.legs());
  attempt("the resolver of a promise: bark", () => home.pet.bark());
  attempt("the resolver of a promise: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S32();
  adopt32(honest32());
  warm += legs32(home) + home.legs();
}
{
  const home = new S32();
  const t = await via32(home);
  attempt("the result of a callback: the same object", () => t === home);
  adopt32(t);
  attempt("the result of a callback: legs + 1", () => legs32(home));
  attempt("the result of a callback: its own method", () => home.legs());
  attempt("the result of a callback: bark", () => home.pet.bark());
  attempt("the result of a callback: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S33();
  adopt33(honest33());
  warm += legs33(home) + home.legs();
}
{
  const home = new S33();
  const t = await via33(home);
  attempt("an explicit type argument: the same object", () => t === home);
  adopt33(t);
  attempt("an explicit type argument: legs + 1", () => legs33(home));
  attempt("an explicit type argument: its own method", () => home.legs());
  attempt("an explicit type argument: bark", () => home.pet.bark());
  attempt("an explicit type argument: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S34();
  adopt34(honest34());
  warm += legs34(home) + home.legs();
}
{
  const home = new S34();
  const t = await via34(home);
  attempt("a constrained type parameter: the same object", () => t === home);
  adopt34(t);
  attempt("a constrained type parameter: legs + 1", () => legs34(home));
  attempt("a constrained type parameter: its own method", () => home.legs());
  attempt("a constrained type parameter: bark", () => home.pet.bark());
  attempt("a constrained type parameter: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S35();
  adopt35(honest35());
  warm += legs35(home) + home.legs();
}
{
  const home = new S35();
  const t = await via35(home);
  attempt("the target of a for-of: the same object", () => t === home);
  adopt35(t);
  attempt("the target of a for-of: legs + 1", () => legs35(home));
  attempt("the target of a for-of: its own method", () => home.legs());
  attempt("the target of a for-of: bark", () => home.pet.bark());
  attempt("the target of a for-of: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
console.log("honest uses", warm);

export {};
