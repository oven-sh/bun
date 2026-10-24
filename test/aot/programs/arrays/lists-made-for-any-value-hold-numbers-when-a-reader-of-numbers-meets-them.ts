// A list made for any value holds nothing but numbers when a reader of lists of numbers meets it. Its maker goes on using it.
function total(xs: number[]): number { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return s; }
function hidden<T>(x: T): T { return JSON.parse("[0]", function (k: string, v: unknown) { return k === "" ? x : v; }); }
function maker(n: number): string {
    const mixed: (number | string | null)[] = [];
    for (let i = 0; i < n; i++) mixed.push(i + 0.5);
    const t = total(mixed as number[]);
    mixed.push("text");
    mixed.push(null);
    mixed[0] = "first";
    return t + " " + mixed[0] + " " + mixed[1] + " " + mixed[n] + " " + mixed[n + 1] + " " + mixed.length;
}
function makerHidden(n: number): string {
    const mixed: (number | string | null)[] = [];
    for (let i = 0; i < n; i++) mixed.push(i + 0.5);
    const t = total(hidden(mixed) as number[]);
    mixed.push("text");
    mixed[0] = null;
    return t + " " + mixed[0] + " " + mixed[1] + " " + mixed[n] + " " + mixed.length;
}
class Box { items: (number | string)[] = []; add(x: number | string) { this.items.push(x); } first() { return this.items[0]; } last() { return this.items[this.items.length - 1]; } }
function boxed(n: number): string {
    const b = new Box();
    for (let i = 0; i < n; i++) b.add(i * 1.25);
    const t = total(hidden(b.items) as number[]);
    b.add("tail");
    return t + " " + b.first() + " " + b.last() + " " + typeof b.items[1];
}
function literal(): string {
    const l: (number | string)[] = [1.5, 2.5, 3.5];
    const t = total(hidden(l) as number[]);
    l[1] = "mid";
    return t + " " + l.join();
}
function objects(n: number): string {
    const l: unknown[] = [];
    for (let i = 0; i < n; i++) l.push(i + 0.25);
    const t = total(hidden(l) as number[]);
    l.push({ a: 1 }); l.push([2]);
    return t + " " + JSON.stringify(l.slice(-3));
}
for (const n of [1, 3, 8, 40, 400]) {
    for (let round = 0; round < 30; round++) { maker(n); makerHidden(n); boxed(n); literal(); objects(n); }
    console.log(n, maker(n), "|", makerHidden(n), "|", boxed(n), "|", literal(), "|", objects(n));
}
