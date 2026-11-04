// a class's constructor and a constructor function read a parameter that is a literal: one object is made, its fields are stored once, and new.target is what it was
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Inner { value: number; constructor(value: number) { this.value = value; } }
const log: string[] = [];
let made = 0;
class Wrap {
    id: number;
    total: number;
    kind: string;
    constructor(inner: Inner, extra: number) { this.id = ++made; log.push("made " + this.id); this.total = inner.value + extra; this.kind = new.target.name; }
}
class Below extends Wrap { more: number; constructor(inner: Inner) { super(inner, 100); this.more = inner.value * 2; } }
function Old(this: any, inner: Inner) { this.id = ++made; log.push("old " + this.id); this.total = inner.value - 1; }
const build = through((inner: Inner) => [new Wrap(inner, 1), new Below(inner), new (Old as any)(inner)]);
for (const inner of [new Inner(5), { value: 6 }, { get value() { log.push("read"); return 7; } }] as any[]) console.log(JSON.stringify(build(inner)));
console.log(made, log.join());
