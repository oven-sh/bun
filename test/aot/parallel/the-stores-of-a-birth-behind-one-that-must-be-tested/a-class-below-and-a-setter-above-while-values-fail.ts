// The class has one below it, a setter comes to stand above one of its names, and the values fit and fail by turns: the slow version does all that the body does.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what stands behind the guard is held against what arrives
class Base {
    kind: number; text: string; first?: object; second?: object; third?: object; fourth?: object; fifth?: object; sixth?: object;
    constructor(kind: number, text: string) { this.kind = kind; this.text = text; this.first = undefined; this.second = undefined; this.third = undefined; this.fourth = undefined; this.fifth = undefined; this.sixth = undefined; }
}
class Below extends Base { more: string; rest?: object; constructor(kind: number, text: string, more: string) { super(kind, text); this.more = more; this.rest = undefined; } }
function base(kind: any, text: any) { return new Base(kind, text); }
function below(kind: any, text: any, more: any) { return new Below(kind, text, more); }
function fill(row: Base, value: object) { row.first = value; row.third = value; row.sixth = value; }
const given: any[] = JSON.parse('[[1, "a", "x"], [2, 5, "y"], [3, "c", 6], [4.5, "d", null], [5, null, "z"], ["6", "f", "w"], [7, "g", {"n": 1}], [8, [9], "v"]]'); let calls = 0;
for (let i = 0; i < given.length; i++) {
    if (i === 3) Object.defineProperty(Base.prototype, "fourth", { set(value) { calls++; }, get() { return "above"; }, configurable: true });
    if (i === 6) delete (Base.prototype as any).fourth;
    for (const row of [base(given[i][0], given[i][1]), below(given[i][0], given[i][1], given[i][2])]) {
        console.log(i, Object.keys(row).join(), String(row.kind), String(row.text), String((row as any).more), String(row.fourth), Object.hasOwn(row, "fourth"), calls, row instanceof Below);
        if (i & 1) { fill(row, given); console.log(Object.keys(row).join(), row.first === given); }
    }
}
