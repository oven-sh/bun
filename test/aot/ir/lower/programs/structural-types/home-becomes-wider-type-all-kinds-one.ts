// RUN: lower
// OPTIONS: builtin-modules

// A home becomes a wider type at every kind of conversion part one.
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

class A0 {
  name = "a0";
}
class D0 extends A0 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C0 extends A0 {
  lives = "nine";
}
class S0 {
  street = "main";
  pet: D0 = new D0();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T0 = { pet: A0 };
function honest0(): T0 {
  return { pet: new A0() };
}
function adopt0(t: T0): void {
  t.pet = new C0();
}
function legs0(home: S0): number {
  return home.pet.legs + 1;
}
function via0(s: S0): T0 {
  const t: T0 = s;
  return t;
}

class A1 {
  name = "a1";
}
class D1 extends A1 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C1 extends A1 {
  lives = "nine";
}
class S1 {
  street = "main";
  pet: D1 = new D1();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T1 = { pet: A1 };
function honest1(): T1 {
  return { pet: new A1() };
}
function adopt1(t: T1): void {
  t.pet = new C1();
}
function legs1(home: S1): number {
  return home.pet.legs + 1;
}
function via1(s: S1): T1 {
  let t: T1 = honest1();
  t = s;
  return t;
}

class A2 {
  name = "a2";
}
class D2 extends A2 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C2 extends A2 {
  lives = "nine";
}
class S2 {
  street = "main";
  pet: D2 = new D2();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T2 = { pet: A2 };
function honest2(): T2 {
  return { pet: new A2() };
}
function adopt2(t: T2): void {
  t.pet = new C2();
}
function legs2(home: S2): number {
  return home.pet.legs + 1;
}
function take2(t: T2): T2 {
  return t;
}
function via2(s: S2): T2 {
  return take2(s);
}

class A3 {
  name = "a3";
}
class D3 extends A3 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C3 extends A3 {
  lives = "nine";
}
class S3 {
  street = "main";
  pet: D3 = new D3();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T3 = { pet: A3 };
function honest3(): T3 {
  return { pet: new A3() };
}
function adopt3(t: T3): void {
  t.pet = new C3();
}
function legs3(home: S3): number {
  return home.pet.legs + 1;
}
function via3(s: S3): T3 {
  return s;
}

class A4 {
  name = "a4";
}
class D4 extends A4 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C4 extends A4 {
  lives = "nine";
}
class S4 {
  street = "main";
  pet: D4 = new D4();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T4 = { pet: A4 };
function honest4(): T4 {
  return { pet: new A4() };
}
function adopt4(t: T4): void {
  t.pet = new C4();
}
function legs4(home: S4): number {
  return home.pet.legs + 1;
}
const via4 = (s: S4): T4 => s;

class A5 {
  name = "a5";
}
class D5 extends A5 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C5 extends A5 {
  lives = "nine";
}
class S5 {
  street = "main";
  pet: D5 = new D5();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T5 = { pet: A5 };
function honest5(): T5 {
  return { pet: new A5() };
}
function adopt5(t: T5): void {
  t.pet = new C5();
}
function legs5(home: S5): number {
  return home.pet.legs + 1;
}
function via5(s: S5): T5 {
  const t: T5 = yes ? s : honest5();
  return t;
}

class A6 {
  name = "a6";
}
class D6 extends A6 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C6 extends A6 {
  lives = "nine";
}
class S6 {
  street = "main";
  pet: D6 = new D6();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T6 = { pet: A6 };
function honest6(): T6 {
  return { pet: new A6() };
}
function adopt6(t: T6): void {
  t.pet = new C6();
}
function legs6(home: S6): number {
  return home.pet.legs + 1;
}
function via6(s: S6, none?: T6): T6 {
  return none ?? s;
}

class A7 {
  name = "a7";
}
class D7 extends A7 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C7 extends A7 {
  lives = "nine";
}
class S7 {
  street = "main";
  pet: D7 = new D7();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T7 = { pet: A7 };
function honest7(): T7 {
  return { pet: new A7() };
}
function adopt7(t: T7): void {
  t.pet = new C7();
}
function legs7(home: S7): number {
  return home.pet.legs + 1;
}
function via7(s: S7, none?: T7): T7 {
  return none || s;
}

class A8 {
  name = "a8";
}
class D8 extends A8 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C8 extends A8 {
  lives = "nine";
}
class S8 {
  street = "main";
  pet: D8 = new D8();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T8 = { pet: A8 };
function honest8(): T8 {
  return { pet: new A8() };
}
function adopt8(t: T8): void {
  t.pet = new C8();
}
function legs8(home: S8): number {
  return home.pet.legs + 1;
}
function via8(s: S8): T8 {
  const t: T8 | boolean = yes && s;
  return typeof t === "boolean" ? honest8() : t;
}

class A9 {
  name = "a9";
}
class D9 extends A9 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C9 extends A9 {
  lives = "nine";
}
class S9 {
  street = "main";
  pet: D9 = new D9();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T9 = { pet: A9 };
function honest9(): T9 {
  return { pet: new A9() };
}
function adopt9(t: T9): void {
  t.pet = new C9();
}
function legs9(home: S9): number {
  return home.pet.legs + 1;
}
function via9(s: S9): T9 {
  return (touch(), s);
}

class A10 {
  name = "a10";
}
class D10 extends A10 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C10 extends A10 {
  lives = "nine";
}
class S10 {
  street = "main";
  pet: D10 = new D10();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T10 = { pet: A10 };
function honest10(): T10 {
  return { pet: new A10() };
}
function adopt10(t: T10): void {
  t.pet = new C10();
}
function legs10(home: S10): number {
  return home.pet.legs + 1;
}
function via10(s: S10): T10 {
  return s satisfies T10;
}

class A11 {
  name = "a11";
}
class D11 extends A11 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C11 extends A11 {
  lives = "nine";
}
class S11 {
  street = "main";
  pet: D11 = new D11();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T11 = { pet: A11 };
function honest11(): T11 {
  return { pet: new A11() };
}
function adopt11(t: T11): void {
  t.pet = new C11();
}
function legs11(home: S11): number {
  return home.pet.legs + 1;
}
function via11(s: S11): T11 {
  const list: T11[] = [honest11(), s];
  return list[1];
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  const home = new S0();
  adopt0(honest0());
  warm += legs0(home) + home.legs();
}
{
  const home = new S0();
  const t = await via0(home);
  attempt("a declaration: the same object", () => t === home);
  adopt0(t);
  attempt("a declaration: legs + 1", () => legs0(home));
  attempt("a declaration: its own method", () => home.legs());
  attempt("a declaration: bark", () => home.pet.bark());
  attempt("a declaration: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S1();
  adopt1(honest1());
  warm += legs1(home) + home.legs();
}
{
  const home = new S1();
  const t = await via1(home);
  attempt("an assignment: the same object", () => t === home);
  adopt1(t);
  attempt("an assignment: legs + 1", () => legs1(home));
  attempt("an assignment: its own method", () => home.legs());
  attempt("an assignment: bark", () => home.pet.bark());
  attempt("an assignment: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S2();
  adopt2(honest2());
  warm += legs2(home) + home.legs();
}
{
  const home = new S2();
  const t = await via2(home);
  attempt("an argument: the same object", () => t === home);
  adopt2(t);
  attempt("an argument: legs + 1", () => legs2(home));
  attempt("an argument: its own method", () => home.legs());
  attempt("an argument: bark", () => home.pet.bark());
  attempt("an argument: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S3();
  adopt3(honest3());
  warm += legs3(home) + home.legs();
}
{
  const home = new S3();
  const t = await via3(home);
  attempt("a return statement: the same object", () => t === home);
  adopt3(t);
  attempt("a return statement: legs + 1", () => legs3(home));
  attempt("a return statement: its own method", () => home.legs());
  attempt("a return statement: bark", () => home.pet.bark());
  attempt("a return statement: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S4();
  adopt4(honest4());
  warm += legs4(home) + home.legs();
}
{
  const home = new S4();
  const t = await via4(home);
  attempt("the body of an arrow function: the same object", () => t === home);
  adopt4(t);
  attempt("the body of an arrow function: legs + 1", () => legs4(home));
  attempt("the body of an arrow function: its own method", () => home.legs());
  attempt("the body of an arrow function: bark", () => home.pet.bark());
  attempt("the body of an arrow function: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S5();
  adopt5(honest5());
  warm += legs5(home) + home.legs();
}
{
  const home = new S5();
  const t = await via5(home);
  attempt("an arm of a conditional expression: the same object", () => t === home);
  adopt5(t);
  attempt("an arm of a conditional expression: legs + 1", () => legs5(home));
  attempt("an arm of a conditional expression: its own method", () => home.legs());
  attempt("an arm of a conditional expression: bark", () => home.pet.bark());
  attempt("an arm of a conditional expression: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S6();
  adopt6(honest6());
  warm += legs6(home) + home.legs();
}
{
  const home = new S6();
  const t = await via6(home);
  attempt("the right side of ??: the same object", () => t === home);
  adopt6(t);
  attempt("the right side of ??: legs + 1", () => legs6(home));
  attempt("the right side of ??: its own method", () => home.legs());
  attempt("the right side of ??: bark", () => home.pet.bark());
  attempt("the right side of ??: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S7();
  adopt7(honest7());
  warm += legs7(home) + home.legs();
}
{
  const home = new S7();
  const t = await via7(home);
  attempt("the right side of ||: the same object", () => t === home);
  adopt7(t);
  attempt("the right side of ||: legs + 1", () => legs7(home));
  attempt("the right side of ||: its own method", () => home.legs());
  attempt("the right side of ||: bark", () => home.pet.bark());
  attempt("the right side of ||: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S8();
  adopt8(honest8());
  warm += legs8(home) + home.legs();
}
{
  const home = new S8();
  const t = await via8(home);
  attempt("the right side of &&: the same object", () => t === home);
  adopt8(t);
  attempt("the right side of &&: legs + 1", () => legs8(home));
  attempt("the right side of &&: its own method", () => home.legs());
  attempt("the right side of &&: bark", () => home.pet.bark());
  attempt("the right side of &&: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S9();
  adopt9(honest9());
  warm += legs9(home) + home.legs();
}
{
  const home = new S9();
  const t = await via9(home);
  attempt("the last operand of a comma: the same object", () => t === home);
  adopt9(t);
  attempt("the last operand of a comma: legs + 1", () => legs9(home));
  attempt("the last operand of a comma: its own method", () => home.legs());
  attempt("the last operand of a comma: bark", () => home.pet.bark());
  attempt("the last operand of a comma: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S10();
  adopt10(honest10());
  warm += legs10(home) + home.legs();
}
{
  const home = new S10();
  const t = await via10(home);
  attempt("satisfies: the same object", () => t === home);
  adopt10(t);
  attempt("satisfies: legs + 1", () => legs10(home));
  attempt("satisfies: its own method", () => home.legs());
  attempt("satisfies: bark", () => home.pet.bark());
  attempt("satisfies: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S11();
  adopt11(honest11());
  warm += legs11(home) + home.legs();
}
{
  const home = new S11();
  const t = await via11(home);
  attempt("an element of an array literal: the same object", () => t === home);
  adopt11(t);
  attempt("an element of an array literal: legs + 1", () => legs11(home));
  attempt("an element of an array literal: its own method", () => home.legs());
  attempt("an element of an array literal: bark", () => home.pet.bark());
  attempt("an element of an array literal: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
console.log("honest uses", warm);

export {};

// GENERATED: legs0 honest1 via8 via11 A0 D0
// CHECK-LABEL: function {{*}}name="legs0"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="pet"
// CHECK-NEXT: v2 = PropGet v1 key="legs"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="honest1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="A1"
// CHECK-NEXT: v2 = Construct v1 calleeName="A1"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_9]]|[[L_7]]|[[L_10]]|[[L_11]]|[[L_12]]|[[L_13]]|[[L_14]]|[[L_15]]|[[L_16]]|[[L_17]]|[[L_18]]|[[L_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="via8"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_20]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_4]] site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_20]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_23]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="yes"
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5(v0)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b5(v6):
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|boolean|[[L_4]] site=[[w_24]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = TypeTest v7 testedType=boolean
// CHECK-NEXT: Branch v8 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v9):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_25]]
// CHECK-NEXT: v11 = Call v10 calleeName="honest8"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|[[L_4]] site=[[w_26]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_4]] site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b8(v12):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_4]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="via11"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_27]] site=[[w_28]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_4]] site=[[w_29]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_27]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_30]]
// CHECK-NEXT: v2 = Call v1 calleeName="honest11"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_4]] site=[[w_31]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = NewArray v3, v0 contents=undefined|null|[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|[[L_4]]> site=[[w_32]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = ElemGet v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_4]] site=[[w_33]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A0"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_34]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_35]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="D0"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_36]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_37]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_37]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_38]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
