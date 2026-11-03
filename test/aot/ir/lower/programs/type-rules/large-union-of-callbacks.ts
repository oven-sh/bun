// RUN: lower
// OPTIONS: builtin-modules

// getUnionSignatures over unions of 16 or more function types: the checker rejects a signature by its first parameter before it compares whole signatures.
// Every case below must resolve exactly as it does for a small union.
declare const console: { log(...values: unknown[]): void };

// 1. The same parameters in every member, different results: one signature matches in all members.
type Same0 = (x: number) => 'r0';
type Same1 = (x: number) => 'r1';
type Same2 = (x: number) => 'r2';
type Same3 = (x: number) => 'r3';
type Same4 = (x: number) => 'r4';
type Same5 = (x: number) => 'r5';
type Same6 = (x: number) => 'r6';
type Same7 = (x: number) => 'r7';
type Same8 = (x: number) => 'r8';
type Same9 = (x: number) => 'r9';
type Same10 = (x: number) => 'r10';
type Same11 = (x: number) => 'r11';
type Same12 = (x: number) => 'r12';
type Same13 = (x: number) => 'r13';
type Same14 = (x: number) => 'r14';
type Same15 = (x: number) => 'r15';
type Same16 = (x: number) => 'r16';
type Same17 = (x: number) => 'r17';
type Same18 = (x: number) => 'r18';
type Same19 = (x: number) => 'r19';
type Same = Same0 | Same1 | Same2 | Same3 | Same4 | Same5 | Same6 | Same7 | Same8 | Same9 | Same10 | Same11 | Same12 | Same13 | Same14 | Same15 | Same16 | Same17 | Same18 | Same19;
const same: Same[] = [(x => 'r0') as Same0, (x => 'r1') as Same1, (x => 'r2') as Same2, (x => 'r3') as Same3, (x => 'r4') as Same4, (x => 'r5') as Same5, (x => 'r6') as Same6, (x => 'r7') as Same7, (x => 'r8') as Same8, (x => 'r9') as Same9, (x => 'r10') as Same10, (x => 'r11') as Same11, (x => 'r12') as Same12, (x => 'r13') as Same13, (x => 'r14') as Same14, (x => 'r15') as Same15, (x => 'r16') as Same16, (x => 'r17') as Same17, (x => 'r18') as Same18, (x => 'r19') as Same19];
let seen = "";
for (const f of same) { const r: 'r0' | 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' | 'r8' | 'r9' | 'r10' | 'r11' | 'r12' | 'r13' | 'r14' | 'r15' | 'r16' | 'r17' | 'r18' | 'r19' = f(1); seen += r; }
console.log(seen);

// 2. One member takes another first parameter: no signature matches in all, the parameters are intersected.
interface Context { name: string }
interface Setup { steps: number }
type Hook0 = (context: Context, payload: { id0: number }) => number;
type Hook1 = (context: Context, payload: { id1: number }) => number;
type Hook2 = (context: Context, payload: { id2: number }) => number;
type Hook3 = (context: Context, payload: { id3: number }) => number;
type Hook4 = (context: Context, payload: { id4: number }) => number;
type Hook5 = (context: Context, payload: { id5: number }) => number;
type Hook6 = (context: Context, payload: { id6: number }) => number;
type Hook7 = (context: Setup, payload: { id7: number }) => number;
type Hook8 = (context: Context, payload: { id8: number }) => number;
type Hook9 = (context: Context, payload: { id9: number }) => number;
type Hook10 = (context: Context, payload: { id10: number }) => number;
type Hook11 = (context: Context, payload: { id11: number }) => number;
type Hook12 = (context: Context, payload: { id12: number }) => number;
type Hook13 = (context: Context, payload: { id13: number }) => number;
type Hook14 = (context: Context, payload: { id14: number }) => number;
type Hook15 = (context: Context, payload: { id15: number }) => number;
type Hook16 = (context: Context, payload: { id16: number }) => number;
type Hook17 = (context: Context, payload: { id17: number }) => number;
type Hook18 = (context: Context, payload: { id18: number }) => number;
type Hook19 = (context: Context, payload: { id19: number }) => number;
type Hook = Hook0 | Hook1 | Hook2 | Hook3 | Hook4 | Hook5 | Hook6 | Hook7 | Hook8 | Hook9 | Hook10 | Hook11 | Hook12 | Hook13 | Hook14 | Hook15 | Hook16 | Hook17 | Hook18 | Hook19;
const hooks: Hook[] = [((context, payload) => context.name.length + payload.id0) as Hook0, ((context, payload) => context.name.length + payload.id1) as Hook1, ((context, payload) => context.name.length + payload.id2) as Hook2, ((context, payload) => context.name.length + payload.id3) as Hook3, ((context, payload) => context.name.length + payload.id4) as Hook4, ((context, payload) => context.name.length + payload.id5) as Hook5, ((context, payload) => context.name.length + payload.id6) as Hook6, ((context, payload) => context.steps + payload.id7) as Hook7, ((context, payload) => context.name.length + payload.id8) as Hook8, ((context, payload) => context.name.length + payload.id9) as Hook9, ((context, payload) => context.name.length + payload.id10) as Hook10, ((context, payload) => context.name.length + payload.id11) as Hook11, ((context, payload) => context.name.length + payload.id12) as Hook12, ((context, payload) => context.name.length + payload.id13) as Hook13, ((context, payload) => context.name.length + payload.id14) as Hook14, ((context, payload) => context.name.length + payload.id15) as Hook15, ((context, payload) => context.name.length + payload.id16) as Hook16, ((context, payload) => context.name.length + payload.id17) as Hook17, ((context, payload) => context.name.length + payload.id18) as Hook18, ((context, payload) => context.name.length + payload.id19) as Hook19];
const everything = { name: "abc", steps: 10, id0: 0, id1: 1, id2: 2, id3: 3, id4: 4, id5: 5, id6: 6, id7: 7, id8: 8, id9: 9, id10: 10, id11: 11, id12: 12, id13: 13, id14: 14, id15: 15, id16: 16, id17: 17, id18: 18, id19: 19 };
let total = 0;
for (const hook of hooks) total += hook(everything, everything);
console.log(total);
// @ts-expect-error: a Context alone is not a Context & Setup.
try { hooks[0]({ name: "abc" }, everything); } catch {}

// 3. Two members are overloaded, so the parameters cannot be intersected: the call resolves only because one signature matches in all members.
interface Overloaded0 { (x: string): string; (x: number): number }
interface Overloaded1 { (x: number): number; (x: boolean): boolean }
type Plain2 = (x: number) => number;
type Plain3 = (x: number) => number;
type Plain4 = (x: number) => number;
type Plain5 = (x: number) => number;
type Plain6 = (x: number) => number;
type Plain7 = (x: number) => number;
type Plain8 = (x: number) => number;
type Plain9 = (x: number) => number;
type Plain10 = (x: number) => number;
type Plain11 = (x: number) => number;
type Plain12 = (x: number) => number;
type Plain13 = (x: number) => number;
type Plain14 = (x: number) => number;
type Plain15 = (x: number) => number;
type Plain16 = (x: number) => number;
type Plain17 = (x: number) => number;
type Plain18 = (x: number) => number;
type Plain19 = (x: number) => number;
interface Tagged { tag: string }
type Mixed = Overloaded0 | Overloaded1 | (Plain2 & { tag2?: string }) | (Plain3 & { tag3?: string }) | (Plain4 & { tag4?: string }) | (Plain5 & { tag5?: string }) | (Plain6 & { tag6?: string }) | (Plain7 & { tag7?: string }) | (Plain8 & { tag8?: string }) | (Plain9 & { tag9?: string }) | (Plain10 & { tag10?: string }) | (Plain11 & { tag11?: string }) | (Plain12 & { tag12?: string }) | (Plain13 & { tag13?: string }) | (Plain14 & { tag14?: string }) | (Plain15 & { tag15?: string }) | (Plain16 & { tag16?: string }) | (Plain17 & { tag17?: string }) | (Plain18 & { tag18?: string }) | (Plain19 & { tag19?: string });
const double = ((x: unknown) => typeof x === "number" ? x * 2 : x) as Overloaded0 & Overloaded1;
const mixed: Mixed[] = [double as Overloaded0, double as Overloaded1, (x: number) => x + 2, (x: number) => x + 3, (x: number) => x + 4, (x: number) => x + 5, (x: number) => x + 6, (x: number) => x + 7, (x: number) => x + 8, (x: number) => x + 9, (x: number) => x + 10, (x: number) => x + 11, (x: number) => x + 12, (x: number) => x + 13, (x: number) => x + 14, (x: number) => x + 15, (x: number) => x + 16, (x: number) => x + 17, (x: number) => x + 18, (x: number) => x + 19];
let sum = 0;
for (const f of mixed) { const r: number = f(1); sum += r; }
console.log(sum);

// 4. The same, but one member takes a first parameter that is unrelated: nothing matches in all members and the union has no call signature.
type Broken = Mixed | ((x: Tagged) => number);
const broken: Broken[] = mixed;
// @ts-expect-error: not callable.
try { console.log(typeof broken[2](1)); } catch {}

// 5. First parameters that are subtypes of each other: a partial match.
interface Animal { legs: number }
interface Dog extends Animal { bark: string }
type Keeper0 = (pet: Animal) => 0;
type Keeper1 = (pet: Dog) => 1;
type Keeper2 = (pet: Animal) => 2;
type Keeper3 = (pet: Dog) => 3;
type Keeper4 = (pet: Animal) => 4;
type Keeper5 = (pet: Dog) => 5;
type Keeper6 = (pet: Animal) => 6;
type Keeper7 = (pet: Dog) => 7;
type Keeper8 = (pet: Animal) => 8;
type Keeper9 = (pet: Dog) => 9;
type Keeper10 = (pet: Animal) => 10;
type Keeper11 = (pet: Dog) => 11;
type Keeper12 = (pet: Animal) => 12;
type Keeper13 = (pet: Dog) => 13;
type Keeper14 = (pet: Animal) => 14;
type Keeper15 = (pet: Dog) => 15;
type Keeper16 = (pet: Animal) => 16;
type Keeper17 = (pet: Dog) => 17;
type Keeper18 = (pet: Animal) => 18;
type Keeper19 = (pet: Dog) => 19;
type Keeper = Keeper0 | Keeper1 | Keeper2 | Keeper3 | Keeper4 | Keeper5 | Keeper6 | Keeper7 | Keeper8 | Keeper9 | Keeper10 | Keeper11 | Keeper12 | Keeper13 | Keeper14 | Keeper15 | Keeper16 | Keeper17 | Keeper18 | Keeper19;
const keepers: Keeper[] = [(pet => 0) as Keeper0, (pet => 1) as Keeper1, (pet => 2) as Keeper2, (pet => 3) as Keeper3, (pet => 4) as Keeper4, (pet => 5) as Keeper5, (pet => 6) as Keeper6, (pet => 7) as Keeper7, (pet => 8) as Keeper8, (pet => 9) as Keeper9, (pet => 10) as Keeper10, (pet => 11) as Keeper11, (pet => 12) as Keeper12, (pet => 13) as Keeper13, (pet => 14) as Keeper14, (pet => 15) as Keeper15, (pet => 16) as Keeper16, (pet => 17) as Keeper17, (pet => 18) as Keeper18, (pet => 19) as Keeper19];
let kept = 0;
for (const keeper of keepers) kept += keeper({ legs: 4, bark: "woof" });
console.log(kept);

// 6. A union of hooks reached through a type parameter escapes to untyped code, which calls it with anything.
type Events = { e0: { v0: number }; e1: { v1: number }; e2: { v2: number }; e3: { v3: number }; e4: { v4: number }; e5: { v5: number }; e6: { v6: number }; e7: { v7: number }; e8: { v8: number }; e9: { v9: number }; e10: { v10: number }; e11: { v11: number }; e12: { v12: number }; e13: { v13: number }; e14: { v14: number }; e15: { v15: number }; e16: { v16: number }; e17: { v17: number }; e18: { v18: number }; e19: { v19: number } };
type Listener<E extends keyof Events> = (context: E extends 'e7' ? Setup : Context, event: Readonly<Events[E]>) => void;
type ListenerFor<P extends keyof Events> = { [E in P]: Listener<E> }[P];
const registered: unknown[] = [];
function makeOn(): <P extends keyof Events>(name: P, listener: NoInfer<ListenerFor<P>>) => void { return (name: unknown, ...rest: [listener: unknown]) => { registered.push(name, rest[0]); }; }
const on = makeOn();
let heard = 0;
on('e3', (context, event) => { heard += context.name.length + event.v3; });
on('e7', (context, event) => { heard += context.steps + event.v7; });
for (let i = 0; i < registered.length; i += 2) (registered[i + 1] as (a: unknown, b: unknown) => void)(everything, { v3: 100, v7: 1000 });
console.log(heard);

// GENERATED: makeOn double
// CHECK-LABEL: function {{*}}name="makeOn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="double"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Convert v2 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Mul v3, v4
// CHECK-NEXT: Jump -> next b6(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b6(v6)
// CHECK-NEXT: b6(v7):
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
