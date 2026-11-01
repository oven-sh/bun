// Dogs become animals at every kind of conversion part three.
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

class A48 {
  name = "a48";
}
class D48 extends A48 {
  legs = 4;
}
class C48 extends A48 {
  lives = "nine";
}
type S48 = D48[];
type T48 = A48[];
function honest48(): T48 {
  return [new A48()];
}
function add48(t: T48): void {
  t.push(new C48());
}
function total48(dogs: S48): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function take48(t: T48): T48 {
  return t;
}
function via48(s: S48): T48 {
  return take48.apply(undefined, [s]);
}

class A49 {
  name = "a49";
}
class D49 extends A49 {
  legs = 4;
}
class C49 extends A49 {
  lives = "nine";
}
type S49 = D49[];
type T49 = A49[];
function honest49(): T49 {
  return [new A49()];
}
function add49(t: T49): void {
  t.push(new C49());
}
function total49(dogs: S49): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function take49(t: T49): T49 {
  return t;
}
function via49(s: S49): T49 {
  return take49.bind(undefined, s)();
}

class A50 {
  name = "a50";
}
class D50 extends A50 {
  legs = 4;
}
class C50 extends A50 {
  lives = "nine";
}
type S50 = D50[];
type T50 = A50[];
function honest50(): T50 {
  return [new A50()];
}
function add50(t: T50): void {
  t.push(new C50());
}
function total50(dogs: S50): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function take50(t: T50): T50 {
  return t;
}
function via50(s: S50): T50 {
  return Reflect.apply(take50, undefined, [s]);
}

class A51 {
  name = "a51";
}
class D51 extends A51 {
  legs = 4;
}
class C51 extends A51 {
  lives = "nine";
}
type S51 = D51[];
type T51 = A51[];
function honest51(): T51 {
  return [new A51()];
}
function add51(t: T51): void {
  t.push(new C51());
}
function total51(dogs: S51): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function self51(this: T51): T51 {
  return this;
}
function via51(s: S51): T51 {
  return self51.call(s);
}

class A52 {
  name = "a52";
}
class D52 extends A52 {
  legs = 4;
}
class C52 extends A52 {
  lives = "nine";
}
type S52 = D52[];
type T52 = A52[];
function honest52(): T52 {
  return [new A52()];
}
function add52(t: T52): void {
  t.push(new C52());
}
function total52(dogs: S52): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via52(s: S52): T52 {
  const holder: { held: T52 } = { held: honest52() };
  holder.held = s;
  return holder.held;
}

class A53 {
  name = "a53";
}
class D53 extends A53 {
  legs = 4;
}
class C53 extends A53 {
  lives = "nine";
}
type S53 = D53[];
type T53 = A53[];
function honest53(): T53 {
  return [new A53()];
}
function add53(t: T53): void {
  t.push(new C53());
}
function total53(dogs: S53): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via53(s: S53): T53 {
  const list: T53[] = [honest53()];
  list[0] = s;
  return list[0];
}

class A54 {
  name = "a54";
}
class D54 extends A54 {
  legs = 4;
}
class C54 extends A54 {
  lives = "nine";
}
type S54 = D54[];
type T54 = A54[];
function honest54(): T54 {
  return [new A54()];
}
function add54(t: T54): void {
  t.push(new C54());
}
function total54(dogs: S54): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via54(s: S54): T54 {
  const holder: { held: T54 } = { held: honest54() };
  [holder.held] = [s];
  return holder.held;
}

class A55 {
  name = "a55";
}
class D55 extends A55 {
  legs = 4;
}
class C55 extends A55 {
  lives = "nine";
}
type S55 = D55[];
type T55 = A55[];
function honest55(): T55 {
  return [new A55()];
}
function add55(t: T55): void {
  t.push(new C55());
}
function total55(dogs: S55): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via55(s: S55): T55 {
  const holder: { held: T55 } = { held: honest55() };
  ({ from: holder.held } = { from: s });
  return holder.held;
}

class A56 {
  name = "a56";
}
class D56 extends A56 {
  legs = 4;
}
class C56 extends A56 {
  lives = "nine";
}
type S56 = D56[];
type T56 = A56[];
function honest56(): T56 {
  return [new A56()];
}
function add56(t: T56): void {
  t.push(new C56());
}
function total56(dogs: S56): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via56(s: S56): T56 {
  const holder: { held: T56 } = { held: honest56() };
  Object.assign(holder, { held: s });
  return holder.held;
}

class A57 {
  name = "a57";
}
class D57 extends A57 {
  legs = 4;
}
class C57 extends A57 {
  lives = "nine";
}
type S57 = D57[];
type T57 = A57[];
function honest57(): T57 {
  return [new A57()];
}
function add57(t: T57): void {
  t.push(new C57());
}
function total57(dogs: S57): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via57(s: S57): T57 {
  const either: T57 | number = s;
  return typeof either === "number" ? honest57() : either;
}

class A58 {
  name = "a58";
}
class D58 extends A58 {
  legs = 4;
}
class C58 extends A58 {
  lives = "nine";
}
type S58 = D58[];
type T58 = A58[];
function honest58(): T58 {
  return [new A58()];
}
function add58(t: T58): void {
  t.push(new C58());
}
function total58(dogs: S58): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via58(s: S58): T58 {
  const record: Record<string, T58> = { k: s };
  return record.k;
}

class A59 {
  name = "a59";
}
class D59 extends A59 {
  legs = 4;
}
class C59 extends A59 {
  lives = "nine";
}
type S59 = D59[];
type T59 = A59[];
function honest59(): T59 {
  return [new A59()];
}
function add59(t: T59): void {
  t.push(new C59());
}
function total59(dogs: S59): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via59(s: S59): T59 {
  const sources: S59[] = [s];
  const list: T59[] = sources;
  return list[0];
}

class A60 {
  name = "a60";
}
class D60 extends A60 {
  legs = 4;
}
class C60 extends A60 {
  lives = "nine";
}
type S60 = D60[];
type T60 = A60[];
function honest60(): T60 {
  return [new A60()];
}
function add60(t: T60): void {
  t.push(new C60());
}
function total60(dogs: S60): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via60(s: S60): T60 {
  const source: { held: S60 } = { held: s };
  const holder: { held: T60 } = source;
  return holder.held;
}

class A61 {
  name = "a61";
}
class D61 extends A61 {
  legs = 4;
}
class C61 extends A61 {
  lives = "nine";
}
type S61 = D61[];
type T61 = A61[];
function honest61(): T61 {
  return [new A61()];
}
function add61(t: T61): void {
  t.push(new C61());
}
function total61(dogs: S61): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via61(s: S61): T61 {
  const sources = new Map<string, S61>([["k", s]]);
  const map: Map<string, T61> = sources;
  return map.get("k") ?? honest61();
}

class A62 {
  name = "a62";
}
class D62 extends A62 {
  legs = 4;
}
class C62 extends A62 {
  lives = "nine";
}
type S62 = D62[];
type T62 = A62[];
function honest62(): T62 {
  return [new A62()];
}
function add62(t: T62): void {
  t.push(new C62());
}
function total62(dogs: S62): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
class Source62 {
  constructor(public held: S62) {}
}
function via62(s: S62): T62 {
  const holder: { held: T62 } = new Source62(s);
  return holder.held;
}

class A63 {
  name = "a63";
}
class D63 extends A63 {
  legs = 4;
}
class C63 extends A63 {
  lives = "nine";
}
type S63 = D63[];
type T63 = A63[];
function honest63(): T63 {
  return [new A63()];
}
function add63(t: T63): void {
  t.push(new C63());
}
function total63(dogs: S63): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via63(s: S63): T63 {
  class Keeper {
    static held: T63 = s;
  }
  return Keeper.held;
}

class A64 {
  name = "a64";
}
class D64 extends A64 {
  legs = 4;
}
class C64 extends A64 {
  lives = "nine";
}
type S64 = D64[];
type T64 = A64[];
function honest64(): T64 {
  return [new A64()];
}
function add64(t: T64): void {
  t.push(new C64());
}
function total64(dogs: S64): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
class Box64<X> {
  constructor(public held: X) {}
}
function via64(s: S64): T64 {
  return new Box64<T64>(s).held;
}

class A65 {
  name = "a65";
}
class D65 extends A65 {
  legs = 4;
}
class C65 extends A65 {
  lives = "nine";
}
type S65 = D65[];
type T65 = A65[];
function honest65(): T65 {
  return [new A65()];
}
function add65(t: T65): void {
  t.push(new C65());
}
function total65(dogs: S65): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via65(s: S65): T65 {
  return Array.of<T65>(s)[0];
}

class A66 {
  name = "a66";
}
class D66 extends A66 {
  legs = 4;
}
class C66 extends A66 {
  lives = "nine";
}
type S66 = D66[];
type T66 = A66[];
function honest66(): T66 {
  return [new A66()];
}
function add66(t: T66): void {
  t.push(new C66());
}
function total66(dogs: S66): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via66(s: S66): T66 {
  const sources: S66[] = [s];
  return Array.from<T66>(sources)[0];
}

class A67 {
  name = "a67";
}
class D67 extends A67 {
  legs = 4;
}
class C67 extends A67 {
  lives = "nine";
}
type S67 = D67[];
type T67 = A67[];
function honest67(): T67 {
  return [new A67()];
}
function add67(t: T67): void {
  t.push(new C67());
}
function total67(dogs: S67): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via67(s: S67): T67 {
  const list: T67[] = [honest67()];
  list.fill(s);
  return list[0];
}

class A68 {
  name = "a68";
}
class D68 extends A68 {
  legs = 4;
}
class C68 extends A68 {
  lives = "nine";
}
type S68 = D68[];
type T68 = A68[];
function honest68(): T68 {
  return [new A68()];
}
function add68(t: T68): void {
  t.push(new C68());
}
function total68(dogs: S68): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via68(s: S68): T68 {
  const list: T68[] = [honest68()];
  list.splice(0, 1, s);
  return list[0];
}

class A69 {
  name = "a69";
}
class D69 extends A69 {
  legs = 4;
}
class C69 extends A69 {
  lives = "nine";
}
type S69 = D69[];
type T69 = A69[];
function honest69(): T69 {
  return [new A69()];
}
function add69(t: T69): void {
  t.push(new C69());
}
function total69(dogs: S69): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via69(s: S69): T69 {
  const list: T69[] = [];
  return list.concat([s])[0];
}

class A70 {
  name = "a70";
}
class D70 extends A70 {
  legs = 4;
}
class C70 extends A70 {
  lives = "nine";
}
type S70 = D70[];
type T70 = A70[];
function honest70(): T70 {
  return [new A70()];
}
function add70(t: T70): void {
  t.push(new C70());
}
function total70(dogs: S70): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via70(s: S70): T70 {
  let t: T70 = honest70();
  const put = (): void => {
    t = s;
  };
  put();
  return t;
}

class A71 {
  name = "a71";
}
class D71 extends A71 {
  legs = 4;
}
class C71 extends A71 {
  lives = "nine";
}
type S71 = D71[];
type T71 = A71[];
function honest71(): T71 {
  return [new A71()];
}
function add71(t: T71): void {
  t.push(new C71());
}
function total71(dogs: S71): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via71(s: S71): T71 {
  const t: T71 & {} = s;
  return t;
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  add48(honest48());
  warm += total48([new D48(), new D48()]);
}
{
  const dogs = [new D48()];
  const t = await via48(dogs);
  attempt("apply: the same array", () => t === dogs);
  add48(t);
  attempt("apply: total legs", () => total48(dogs));
  attempt("apply: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add49(honest49());
  warm += total49([new D49(), new D49()]);
}
{
  const dogs = [new D49()];
  const t = await via49(dogs);
  attempt("bind: the same array", () => t === dogs);
  add49(t);
  attempt("bind: total legs", () => total49(dogs));
  attempt("bind: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add50(honest50());
  warm += total50([new D50(), new D50()]);
}
{
  const dogs = [new D50()];
  const t = await via50(dogs);
  attempt("Reflect.apply: the same array", () => t === dogs);
  add50(t);
  attempt("Reflect.apply: total legs", () => total50(dogs));
  attempt("Reflect.apply: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add51(honest51());
  warm += total51([new D51(), new D51()]);
}
{
  const dogs = [new D51()];
  const t = await via51(dogs);
  attempt("this of a call: the same array", () => t === dogs);
  add51(t);
  attempt("this of a call: total legs", () => total51(dogs));
  attempt("this of a call: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add52(honest52());
  warm += total52([new D52(), new D52()]);
}
{
  const dogs = [new D52()];
  const t = await via52(dogs);
  attempt("a store to a member: the same array", () => t === dogs);
  add52(t);
  attempt("a store to a member: total legs", () => total52(dogs));
  attempt("a store to a member: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add53(honest53());
  warm += total53([new D53(), new D53()]);
}
{
  const dogs = [new D53()];
  const t = await via53(dogs);
  attempt("a store to an element: the same array", () => t === dogs);
  add53(t);
  attempt("a store to an element: total legs", () => total53(dogs));
  attempt("a store to an element: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add54(honest54());
  warm += total54([new D54(), new D54()]);
}
{
  const dogs = [new D54()];
  const t = await via54(dogs);
  attempt("an array pattern that is assigned to: the same array", () => t === dogs);
  add54(t);
  attempt("an array pattern that is assigned to: total legs", () => total54(dogs));
  attempt("an array pattern that is assigned to: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add55(honest55());
  warm += total55([new D55(), new D55()]);
}
{
  const dogs = [new D55()];
  const t = await via55(dogs);
  attempt("an object pattern that is assigned to: the same array", () => t === dogs);
  add55(t);
  attempt("an object pattern that is assigned to: total legs", () => total55(dogs));
  attempt("an object pattern that is assigned to: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add56(honest56());
  warm += total56([new D56(), new D56()]);
}
{
  const dogs = [new D56()];
  const t = await via56(dogs);
  attempt("Object.assign: the same array", () => t === dogs);
  add56(t);
  attempt("Object.assign: total legs", () => total56(dogs));
  attempt("Object.assign: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add57(honest57());
  warm += total57([new D57(), new D57()]);
}
{
  const dogs = [new D57()];
  const t = await via57(dogs);
  attempt("a union that is narrowed again: the same array", () => t === dogs);
  add57(t);
  attempt("a union that is narrowed again: total legs", () => total57(dogs));
  attempt("a union that is narrowed again: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add58(honest58());
  warm += total58([new D58(), new D58()]);
}
{
  const dogs = [new D58()];
  const t = await via58(dogs);
  attempt("an entry of a record: the same array", () => t === dogs);
  add58(t);
  attempt("an entry of a record: total legs", () => total58(dogs));
  attempt("an entry of a record: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add59(honest59());
  warm += total59([new D59(), new D59()]);
}
{
  const dogs = [new D59()];
  const t = await via59(dogs);
  attempt("an array of the narrower type: the same array", () => t === dogs);
  add59(t);
  attempt("an array of the narrower type: total legs", () => total59(dogs));
  attempt("an array of the narrower type: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add60(honest60());
  warm += total60([new D60(), new D60()]);
}
{
  const dogs = [new D60()];
  const t = await via60(dogs);
  attempt("an object with a member of the narrower type: the same array", () => t === dogs);
  add60(t);
  attempt("an object with a member of the narrower type: total legs", () => total60(dogs));
  attempt("an object with a member of the narrower type: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add61(honest61());
  warm += total61([new D61(), new D61()]);
}
{
  const dogs = [new D61()];
  const t = await via61(dogs);
  attempt("a map of the narrower type: the same array", () => t === dogs);
  add61(t);
  attempt("a map of the narrower type: total legs", () => total61(dogs));
  attempt("a map of the narrower type: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add62(honest62());
  warm += total62([new D62(), new D62()]);
}
{
  const dogs = [new D62()];
  const t = await via62(dogs);
  attempt("an instance with a field of the narrower type: the same array", () => t === dogs);
  add62(t);
  attempt("an instance with a field of the narrower type: total legs", () => total62(dogs));
  attempt("an instance with a field of the narrower type: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add63(honest63());
  warm += total63([new D63(), new D63()]);
}
{
  const dogs = [new D63()];
  const t = await via63(dogs);
  attempt("a static field: the same array", () => t === dogs);
  add63(t);
  attempt("a static field: total legs", () => total63(dogs));
  attempt("a static field: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add64(honest64());
  warm += total64([new D64(), new D64()]);
}
{
  const dogs = [new D64()];
  const t = await via64(dogs);
  attempt("a generic class: the same array", () => t === dogs);
  add64(t);
  attempt("a generic class: total legs", () => total64(dogs));
  attempt("a generic class: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add65(honest65());
  warm += total65([new D65(), new D65()]);
}
{
  const dogs = [new D65()];
  const t = await via65(dogs);
  attempt("Array.of: the same array", () => t === dogs);
  add65(t);
  attempt("Array.of: total legs", () => total65(dogs));
  attempt("Array.of: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add66(honest66());
  warm += total66([new D66(), new D66()]);
}
{
  const dogs = [new D66()];
  const t = await via66(dogs);
  attempt("Array.from: the same array", () => t === dogs);
  add66(t);
  attempt("Array.from: total legs", () => total66(dogs));
  attempt("Array.from: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add67(honest67());
  warm += total67([new D67(), new D67()]);
}
{
  const dogs = [new D67()];
  const t = await via67(dogs);
  attempt("fill: the same array", () => t === dogs);
  add67(t);
  attempt("fill: total legs", () => total67(dogs));
  attempt("fill: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add68(honest68());
  warm += total68([new D68(), new D68()]);
}
{
  const dogs = [new D68()];
  const t = await via68(dogs);
  attempt("splice: the same array", () => t === dogs);
  add68(t);
  attempt("splice: total legs", () => total68(dogs));
  attempt("splice: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add69(honest69());
  warm += total69([new D69(), new D69()]);
}
{
  const dogs = [new D69()];
  const t = await via69(dogs);
  attempt("concat: the same array", () => t === dogs);
  add69(t);
  attempt("concat: total legs", () => total69(dogs));
  attempt("concat: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add70(honest70());
  warm += total70([new D70(), new D70()]);
}
{
  const dogs = [new D70()];
  const t = await via70(dogs);
  attempt("a variable that a closure assigns: the same array", () => t === dogs);
  add70(t);
  attempt("a variable that a closure assigns: total legs", () => total70(dogs));
  attempt("a variable that a closure assigns: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add71(honest71());
  warm += total71([new D71(), new D71()]);
}
{
  const dogs = [new D71()];
  const t = await via71(dogs);
  attempt("an intersection with the empty object type: the same array", () => t === dogs);
  add71(t);
  attempt("an intersection with the empty object type: total legs", () => total71(dogs));
  attempt("an intersection with the empty object type: legs", () => dogs.map(dog => dog.legs));
}
console.log("honest uses", warm);

export {};
