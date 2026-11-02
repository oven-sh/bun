// RUN: lower
// OPTIONS: builtin-modules

// The value of an enum member that is written as a power is what the same power yields anywhere else in the program.
const unknown = <T,>(x: T): T => x;
enum Size { Small = 3 ** 100, Next, Twice = Small * 2, Named = Size.Small, Root = 2147483647 ** 0.1, Exact = 2 ** 10, Negative = -(5 ** 33), Text = `${7 ** 30}`, Mixed = (3 ** 100) % 1000 }
const enum Inlined { Big = 3 ** 100, Next, Half = Big / 2 }
enum Other { Borrowed = Size.Small, Sum = Size.Small + Size.Root }
const held = 3 ** 100;
const three = 3, hundred = 100;
const run = unknown(3) ** unknown(100);
console.log(Size.Small === run, Size.Small === 3 ** 100, Size.Small === held, Size.Small === three ** hundred, Size.Small === Math.pow(3, 100));
console.log(Size.Next === run + 1, Size.Twice === run * 2, Size.Named === run, Size.Root === unknown(2147483647) ** unknown(0.1), Size.Exact, Size.Negative === -(unknown(5) ** unknown(33)));
console.log(Size.Text === String(unknown(7) ** unknown(30)), Size.Mixed === run % 1000);
console.log(Inlined.Big === run, Inlined.Next === run + 1, Inlined.Half === run / 2);
console.log(Other.Borrowed === run, Other.Sum === run + unknown(2147483647) ** unknown(0.1));
console.log(Size[Size.Small], Size[run], Size[Size.Exact], Object.keys(Size).length);
console.log(`${3 ** 100}` === String(run), `${held}` === String(run), `${Size.Small}` === String(run), "" + 3 ** 100 === String(run), `a${5 ** 33}b` === "a" + unknown(5) ** unknown(33) + "b");
const member: Size.Small = Size.Small;
const list: Size[] = [Size.Small, Size.Root];
console.log(member === run, list[0] === run, list.includes(run as Size), new Set<Size>(list).has(run as Size), { [Size.Small]: 1 }[run]);
switch (run as Size) { case Size.Small: console.log("the case is met"); break; default: console.log("the case is missed"); }

// GENERATED: unknown
// CHECK-LABEL: function {{*}}name="unknown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=undefined|null|[[L_1]] site=[[w_3]]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] site=[[w_3]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
