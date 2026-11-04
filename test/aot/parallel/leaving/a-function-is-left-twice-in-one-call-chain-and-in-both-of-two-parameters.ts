// the caller is left behind its first call, whose callee was left too
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Unit { cost: number; constructor(cost: number) { this.cost = cost; } }
const log: string[] = [];
function price(unit: Unit, count: number): number { log.push("price"); return unit.cost * count; }
function bill(first: Unit, second: Unit, count: number): number {
    log.push("bill");
    const one = price(first, count);
    log.push("one " + one);
    const direct = second.cost;
    const two = price(second, count + 1);
    log.push("two " + two);
    return one + two + direct + first.cost;
}
const billByValue = through(bill);
const u = new Unit(3);
const l: any = { cost: 4 };
for (const [a, b] of [[u, u], [u, l], [l, u], [l, l]]) { log.length = 0; console.log(billByValue(a, b, 2), log.join()); }
