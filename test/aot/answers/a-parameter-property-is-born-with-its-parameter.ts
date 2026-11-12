// answers: with-library
// # `constructor(public left: number)`: the field of a parameter property is defined in the constructor with the parameter itself: `undefined` is never laid, so a read of it is no `undefined|..`. Beside the plain case:
// # the order of the keys (the parameter properties first, then the fields as declared), a default that hands `this` out and must see undefined, a parameter that the body changes or a closure holds, a second store,
// # a class below, an argument left out, an initializer that calls, accessors above that may not run, Reflect.construct with another target.
// # f2 = total, f3 = lengths
// # RUN(FORM): walk f2 f3 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: @Double = GetSlot {{*}}key="left"
// # FORM-LABEL: code f3:Body
// # FORM: : boolean @{{*}} = GetSlot {{*}}key="open"
// # FORM: : string @JSValue = GetSlot {{*}}key="name"
// # FORM: : int[0, 2147483647] @{{*}} = GetSlot {{*}}key="size"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 16 of 16 of 16
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const seen: unknown[] = [];
function look(object: object): void { seen.push(Object.keys(object).join() + ":" + JSON.stringify(object)); }

class Pair { constructor(public left: number, public right: number) { } }
function total(list: Pair[]): number { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]!.left * 2 + list[i]!.right; return sum; }
report(total([new Pair(0.5, 1), new Pair(1.25, 2)]));

class Named { size: number; constructor(public name: string, size: number, readonly open: boolean) { this.size = size; } }
function lengths(list: Named[]): number { let sum = 0; for (const one of list) sum += one.open ? one.name.length * one.size : 0; return sum; }
report(lengths([new Named("ab", 2, true), new Named("cde", 3, true), new Named("f", 9, false)]));

class Shown { size: number; constructor(public name: string, size: number, readonly open: boolean) { this.size = size; } }
report(Object.keys(new Shown("a", 1, true)).join() + JSON.stringify(new Shown("a", 1, true)));

class Mixed { a = 1; b: number; constructor(public c: number, b: number, private d: string, protected e: null) { this.b = b; } }
report(Object.keys(new Mixed(3, 2, "d", null)).join() + JSON.stringify(new Mixed(3, 2, "d", null)));

class WithDefault { constructor(public a: number = 3, public b?: number) { } }
report(Object.keys(new WithDefault()).join() + JSON.stringify(new WithDefault()) + String(new WithDefault().b) + JSON.stringify(new WithDefault(1, 2)));

// @ts-ignore
class Looked { constructor(public a: number, b: unknown = look(this)) { } }
new Looked(4);
report(seen.pop());

class Reassigns { constructor(public a: number) { a = a + 1; } }
report(new Reassigns(1).a);

class Captures { read: () => number; constructor(public a: number) { this.read = () => a; a = a + 5; } }
report(new Captures(1).a + ":" + new Captures(1).read());

class StoresAgain { constructor(public a: number) { this.a = a + 1; } }
report(new StoresAgain(1).a);

class StoresAParameterAgain { constructor(public a: number, b: number) { this.a = b; } }
report(new StoresAParameterAgain(1, 2).a);

class Below extends Pair { constructor(public third: number) { super(1, 2); } }
report(Object.keys(new Below(3)).join() + JSON.stringify(new Below(3)) + total([new Below(3)]));

report(String(new (Shown as any)("only").size) + ":" + String(new (Shown as any)("only").open) + ":" + Object.keys(new (Shown as any)("only")).join());

class Calls { id = look(seen); constructor(public a: number) { } }
report(JSON.stringify(new Calls(5)) + seen.length);

let ran = 0;
class Guarded { constructor(public guarded: number) { } }
Object.defineProperty(Guarded.prototype, "guarded", { set(value: unknown) { ran++; }, get() { ran++; return 9; }, configurable: true });
report(new Guarded(4).guarded + ":" + ran + ":" + Object.keys(new Guarded(4)).join());

class Other { tell(): string { return "other"; } }
const turned = Reflect.construct(Shown, ["n", 2, false], Other) as Shown & Other;
report(turned.tell() + JSON.stringify(turned) + (turned instanceof Shown));
report("end");
