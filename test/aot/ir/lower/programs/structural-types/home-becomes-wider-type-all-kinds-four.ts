// RUN: lower
// OPTIONS: builtin-modules

// A home becomes a wider type at every kind of conversion part four.
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

class A36 {
  name = "a36";
}
class D36 extends A36 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C36 extends A36 {
  lives = "nine";
}
class S36 {
  street = "main";
  pet: D36 = new D36();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T36 = { pet: A36 };
function honest36(): T36 {
  return { pet: new A36() };
}
function adopt36(t: T36): void {
  t.pet = new C36();
}
function legs36(home: S36): number {
  return home.pet.legs + 1;
}
function via36(s: S36): T36 {
  let t: T36 | undefined;
  t ??= s;
  return t;
}

class A37 {
  name = "a37";
}
class D37 extends A37 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C37 extends A37 {
  lives = "nine";
}
class S37 {
  street = "main";
  pet: D37 = new D37();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T37 = { pet: A37 };
function honest37(): T37 {
  return { pet: new A37() };
}
function adopt37(t: T37): void {
  t.pet = new C37();
}
function legs37(home: S37): number {
  return home.pet.legs + 1;
}
function via37(s: S37): T37 {
  let t: T37 | undefined;
  t ||= s;
  return t;
}

class A38 {
  name = "a38";
}
class D38 extends A38 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C38 extends A38 {
  lives = "nine";
}
class S38 {
  street = "main";
  pet: D38 = new D38();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T38 = { pet: A38 };
function honest38(): T38 {
  return { pet: new A38() };
}
function adopt38(t: T38): void {
  t.pet = new C38();
}
function legs38(home: S38): number {
  return home.pet.legs + 1;
}
function via38(s: S38): T38 {
  const holder = {
    get held(): T38 {
      return s;
    },
  };
  return holder.held;
}

class A39 {
  name = "a39";
}
class D39 extends A39 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C39 extends A39 {
  lives = "nine";
}
class S39 {
  street = "main";
  pet: D39 = new D39();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T39 = { pet: A39 };
function honest39(): T39 {
  return { pet: new A39() };
}
function adopt39(t: T39): void {
  t.pet = new C39();
}
function legs39(home: S39): number {
  return home.pet.legs + 1;
}
class Keeper39 {
  private stored: T39 = honest39();
  set held(t: T39) {
    this.stored = t;
  }
  get held(): T39 {
    return this.stored;
  }
}
function via39(s: S39): T39 {
  const keeper = new Keeper39();
  keeper.held = s;
  return keeper.held;
}

class A40 {
  name = "a40";
}
class D40 extends A40 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C40 extends A40 {
  lives = "nine";
}
class S40 {
  street = "main";
  pet: D40 = new D40();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T40 = { pet: A40 };
function honest40(): T40 {
  return { pet: new A40() };
}
function adopt40(t: T40): void {
  t.pet = new C40();
}
function legs40(home: S40): number {
  return home.pet.legs + 1;
}
function via40(s: S40): T40 {
  const give = (): S40 => s;
  const wider: () => T40 = give;
  return wider();
}

class A41 {
  name = "a41";
}
class D41 extends A41 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C41 extends A41 {
  lives = "nine";
}
class S41 {
  street = "main";
  pet: D41 = new D41();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T41 = { pet: A41 };
function honest41(): T41 {
  return { pet: new A41() };
}
function adopt41(t: T41): void {
  t.pet = new C41();
}
function legs41(home: S41): number {
  return home.pet.legs + 1;
}
function via41(s: S41): T41 {
  const kept: T41[] = [];
  const take = (t: T41): void => void kept.push(t);
  const narrower: (s: S41) => void = take;
  narrower(s);
  return kept[0];
}

class A42 {
  name = "a42";
}
class D42 extends A42 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C42 extends A42 {
  lives = "nine";
}
class S42 {
  street = "main";
  pet: D42 = new D42();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T42 = { pet: A42 };
function honest42(): T42 {
  return { pet: new A42() };
}
function adopt42(t: T42): void {
  t.pet = new C42();
}
function legs42(home: S42): number {
  return home.pet.legs + 1;
}
interface Taker42 {
  take(s: S42): T42;
}
class Wide42 implements Taker42 {
  take(t: T42): T42 {
    return t;
  }
}
function via42(s: S42): T42 {
  const taker: Taker42 = new Wide42();
  return taker.take(s);
}

class A43 {
  name = "a43";
}
class D43 extends A43 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C43 extends A43 {
  lives = "nine";
}
class S43 {
  street = "main";
  pet: D43 = new D43();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T43 = { pet: A43 };
function honest43(): T43 {
  return { pet: new A43() };
}
function adopt43(t: T43): void {
  t.pet = new C43();
}
function legs43(home: S43): number {
  return home.pet.legs + 1;
}
function via43(s: S43): T43 {
  const pair: [number, T43] = [1, s];
  return pair[1];
}

class A44 {
  name = "a44";
}
class D44 extends A44 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C44 extends A44 {
  lives = "nine";
}
class S44 {
  street = "main";
  pet: D44 = new D44();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T44 = { pet: A44 };
function honest44(): T44 {
  return { pet: new A44() };
}
function adopt44(t: T44): void {
  t.pet = new C44();
}
function legs44(home: S44): number {
  return home.pet.legs + 1;
}
function tag44(strings: TemplateStringsArray, t: T44): T44 {
  return t;
}
function via44(s: S44): T44 {
  return tag44`${s}`;
}

class A45 {
  name = "a45";
}
class D45 extends A45 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C45 extends A45 {
  lives = "nine";
}
class S45 {
  street = "main";
  pet: D45 = new D45();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T45 = { pet: A45 };
function honest45(): T45 {
  return { pet: new A45() };
}
function adopt45(t: T45): void {
  t.pet = new C45();
}
function legs45(home: S45): number {
  return home.pet.legs + 1;
}
class Base45 {
  constructor(public held: T45) {}
}
class Derived45 extends Base45 {
  constructor(s: S45) {
    super(s);
  }
}
function via45(s: S45): T45 {
  return new Derived45(s).held;
}

class A46 {
  name = "a46";
}
class D46 extends A46 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C46 extends A46 {
  lives = "nine";
}
class S46 {
  street = "main";
  pet: D46 = new D46();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T46 = { pet: A46 };
function honest46(): T46 {
  return { pet: new A46() };
}
function adopt46(t: T46): void {
  t.pet = new C46();
}
function legs46(home: S46): number {
  return home.pet.legs + 1;
}
function via46(s: S46): T46 {
  const holder: { take?: (t: T46) => T46 } = { take: t => t };
  return holder.take?.(s) ?? honest46();
}

class A47 {
  name = "a47";
}
class D47 extends A47 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C47 extends A47 {
  lives = "nine";
}
class S47 {
  street = "main";
  pet: D47 = new D47();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T47 = { pet: A47 };
function honest47(): T47 {
  return { pet: new A47() };
}
function adopt47(t: T47): void {
  t.pet = new C47();
}
function legs47(home: S47): number {
  return home.pet.legs + 1;
}
function take47(t: T47): T47 {
  return t;
}
function via47(s: S47): T47 {
  return take47.call(undefined, s);
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  const home = new S36();
  adopt36(honest36());
  warm += legs36(home) + home.legs();
}
{
  const home = new S36();
  const t = await via36(home);
  attempt("??=: the same object", () => t === home);
  adopt36(t);
  attempt("??=: legs + 1", () => legs36(home));
  attempt("??=: its own method", () => home.legs());
  attempt("??=: bark", () => home.pet.bark());
  attempt("??=: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S37();
  adopt37(honest37());
  warm += legs37(home) + home.legs();
}
{
  const home = new S37();
  const t = await via37(home);
  attempt("||=: the same object", () => t === home);
  adopt37(t);
  attempt("||=: legs + 1", () => legs37(home));
  attempt("||=: its own method", () => home.legs());
  attempt("||=: bark", () => home.pet.bark());
  attempt("||=: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S38();
  adopt38(honest38());
  warm += legs38(home) + home.legs();
}
{
  const home = new S38();
  const t = await via38(home);
  attempt("the result of a getter: the same object", () => t === home);
  adopt38(t);
  attempt("the result of a getter: legs + 1", () => legs38(home));
  attempt("the result of a getter: its own method", () => home.legs());
  attempt("the result of a getter: bark", () => home.pet.bark());
  attempt("the result of a getter: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S39();
  adopt39(honest39());
  warm += legs39(home) + home.legs();
}
{
  const home = new S39();
  const t = await via39(home);
  attempt("the parameter of a setter: the same object", () => t === home);
  adopt39(t);
  attempt("the parameter of a setter: legs + 1", () => legs39(home));
  attempt("the parameter of a setter: its own method", () => home.legs());
  attempt("the parameter of a setter: bark", () => home.pet.bark());
  attempt("the parameter of a setter: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S40();
  adopt40(honest40());
  warm += legs40(home) + home.legs();
}
{
  const home = new S40();
  const t = await via40(home);
  attempt("the result of a function type: the same object", () => t === home);
  adopt40(t);
  attempt("the result of a function type: legs + 1", () => legs40(home));
  attempt("the result of a function type: its own method", () => home.legs());
  attempt("the result of a function type: bark", () => home.pet.bark());
  attempt("the result of a function type: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S41();
  adopt41(honest41());
  warm += legs41(home) + home.legs();
}
{
  const home = new S41();
  const t = await via41(home);
  attempt("the parameter of a function type: the same object", () => t === home);
  adopt41(t);
  attempt("the parameter of a function type: legs + 1", () => legs41(home));
  attempt("the parameter of a function type: its own method", () => home.legs());
  attempt("the parameter of a function type: bark", () => home.pet.bark());
  attempt("the parameter of a function type: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S42();
  adopt42(honest42());
  warm += legs42(home) + home.legs();
}
{
  const home = new S42();
  const t = await via42(home);
  attempt("a method that implements an interface: the same object", () => t === home);
  adopt42(t);
  attempt("a method that implements an interface: legs + 1", () => legs42(home));
  attempt("a method that implements an interface: its own method", () => home.legs());
  attempt("a method that implements an interface: bark", () => home.pet.bark());
  attempt("a method that implements an interface: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S43();
  adopt43(honest43());
  warm += legs43(home) + home.legs();
}
{
  const home = new S43();
  const t = await via43(home);
  attempt("a place of a tuple: the same object", () => t === home);
  adopt43(t);
  attempt("a place of a tuple: legs + 1", () => legs43(home));
  attempt("a place of a tuple: its own method", () => home.legs());
  attempt("a place of a tuple: bark", () => home.pet.bark());
  attempt("a place of a tuple: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S44();
  adopt44(honest44());
  warm += legs44(home) + home.legs();
}
{
  const home = new S44();
  const t = await via44(home);
  attempt("a tagged template: the same object", () => t === home);
  adopt44(t);
  attempt("a tagged template: legs + 1", () => legs44(home));
  attempt("a tagged template: its own method", () => home.legs());
  attempt("a tagged template: bark", () => home.pet.bark());
  attempt("a tagged template: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S45();
  adopt45(honest45());
  warm += legs45(home) + home.legs();
}
{
  const home = new S45();
  const t = await via45(home);
  attempt("an argument of super: the same object", () => t === home);
  adopt45(t);
  attempt("an argument of super: legs + 1", () => legs45(home));
  attempt("an argument of super: its own method", () => home.legs());
  attempt("an argument of super: bark", () => home.pet.bark());
  attempt("an argument of super: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S46();
  adopt46(honest46());
  warm += legs46(home) + home.legs();
}
{
  const home = new S46();
  const t = await via46(home);
  attempt("an optional call: the same object", () => t === home);
  adopt46(t);
  attempt("an optional call: legs + 1", () => legs46(home));
  attempt("an optional call: its own method", () => home.legs());
  attempt("an optional call: bark", () => home.pet.bark());
  attempt("an optional call: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S47();
  adopt47(honest47());
  warm += legs47(home) + home.legs();
}
{
  const home = new S47();
  const t = await via47(home);
  attempt("call: the same object", () => t === home);
  adopt47(t);
  attempt("call: legs + 1", () => legs47(home));
  attempt("call: its own method", () => home.legs());
  attempt("call: bark", () => home.pet.bark());
  attempt("call: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
console.log("honest uses", warm);

export {};

// GENERATED: honest39 via44 held D36 Derived45
// CHECK-LABEL: function {{*}}name="honest39"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="A39"
// CHECK-NEXT: v2 = Construct v1 calleeName="A39"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_6]]|[[L_7]]|[[L_8]]|[[L_4]]|[[L_9]]|[[L_10]]|[[L_11]]|[[L_12]]|[[L_13]]|[[L_14]]|[[L_15]]|[[L_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_1]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="via44"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_17]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_1]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_17]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_20]]
// CHECK-NEXT: v2 = NewTemplateObject templateStrings=[{cooked="" raw=""}, {cooked="" raw=""}]
// CHECK-NEXT: v3 = Call v1, -, v2, v0 calleeName="tag44"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|[[L_1]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_1]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="held"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_22]] site=[[w_23]]} parameters=[{type=undefined|null|[[L_1]] site=[[w_24]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_22]], v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_1]] site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v0, v2 key="stored"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="held"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_22]] site=[[w_26]]} results=[{type=undefined|null|[[L_1]] site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_22]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="stored"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_1]] site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="D36"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_28]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_29]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_29]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_30]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived45"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_31]] site=[[w_32]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_33]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|[[L_31]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_34]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_34]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b8(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = TypeTest v12 testedType=undefined
// CHECK-NEXT: Branch v13 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v15 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v16) frequency=Unlikely:
// CHECK-NEXT: v17 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v17
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: Jump -> next b8(v18)
// CHECK-NEXT: b8(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: b9(v20) frequency=Unlikely:
// CHECK-NEXT: v21 = NewRuntimeError runtimeError=DerivedConstructorResult name="Derived45"
// CHECK-NEXT: Throw v21
// CHECK-NEXT: b10(v22) frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="held"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] captures=[{type=undefined|null|[[L_35]] site=[[w_36]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=undefined|null|[[L_1]] site=[[w_37]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_35]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] site=[[w_37]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
