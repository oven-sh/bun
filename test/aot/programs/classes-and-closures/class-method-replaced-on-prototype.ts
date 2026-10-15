// Classes with one method replaced on the prototype. The other methods are looked up by name through `any`, read back and called.
const lines: string[] = [];
class Shape {
    constructor(public name: string, public sides: number) {}
    describe(): string { return this.name + " with " + this.sides + " sides"; }
    area(): number { return 0; }
    perimeter(): number { return this.sides; }
    get label(): string { return "<" + this.name + ">"; }
    set label(value: string) { this.name = value.slice(1, -1); }
    get kind(): string { return "shape"; }
    toString(): string { return this.describe(); }
    static of(name: string): Shape { return new Shape(name, 3); }
}
class Square extends Shape {
    constructor(public side: number) { super("square", 4); }
    override area(): number { return this.side * this.side; }
    override perimeter(): number { return this.side * 4; }
    override get kind(): string { return "square"; }
    diagonal(): number { return Math.round(this.side * Math.SQRT2 * 100) / 100; }
}
class Counter {
    count = 0;
    step(): number { return ++this.count; }
    reset(): void { this.count = 0; }
    peek(): number { return this.count; }
}
(Shape.prototype as any).area = function (this: Shape): number { return -1; };
(Counter.prototype as any).step = function (this: Counter): number { return this.count += 10; };

const anything: any[] = [new Shape("triangle", 3), new Square(2), Shape.of("other"), new Counter()];
for (const value of anything) {
    for (const name of ["describe", "area", "perimeter", "diagonal", "step", "peek", "toString", "missing"]) {
        const member = value[name];
        lines.push(value.constructor.name + "." + name + ": " + (typeof member === "function" ? String(member.call(value)) : typeof member));
    }
    lines.push(value.constructor.name + " label " + String(value.label) + " kind " + String(value.kind) + " then " + typeof value.then);
}
const square: any = anything[1];
square.label = "<renamed>";
lines.push(square.describe(), String(square), `${square}`, JSON.stringify(square));
for (const holder of [Shape.prototype, Square.prototype, Counter.prototype] as object[]) {
    lines.push(Object.getOwnPropertyNames(holder).join() + " | " + Object.keys(holder).join() + " | " + Object.getOwnPropertyNames(holder).map(name => { const d = Object.getOwnPropertyDescriptor(holder, name)!; return name + ":" + ("value" in d ? "value" : (d.get ? "get" : "") + (d.set ? "set" : "")) + (d.enumerable ? " enumerable" : ""); }).join());
}
lines.push(String(anything[1] instanceof Shape), String(Object.getPrototypeOf(Square.prototype) === Shape.prototype), String((Square.prototype as any).constructor === Square));
const counter = new Counter();
lines.push(String(counter.step()), String(counter.step()), String(counter.peek()));
counter.reset();
lines.push(String(counter.peek()), String(new Shape("s", 1).area()), String(new Square(3).area()));
console.log(lines.join("\n"));
