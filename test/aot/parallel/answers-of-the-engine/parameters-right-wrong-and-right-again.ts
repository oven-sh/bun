// Each kind of declared parameter, and this, is handed what is declared, what is not, undefined, null, nothing and too much, in turns: the guard at the entry lets the one kind into the fast version and sends the other to the slow one. An object is changed by a callee in the middle of the fast version, a parameter is assigned to, and a recursion turns wrong halfway down.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } sum(): number { return this.x + this.y; } scaled(by: number): number { return this.x * by + this.y * by; } }
class Point3 extends Point { z: number; constructor(x: number, y: number, z: number) { super(x, y); this.z = z; } sum(): number { return this.x + this.y + this.z; } }
let said = "";
const any = (value: unknown): any => value; // @ts-expect-error
function tell(run: () => unknown) { try { report(String(run())); } catch (thrown) { report((thrown as Error).name); } }
function area(point: Point, scale: number): number { const across = point.x * scale; const down = point.y * scale; return across * down + point.x; }
function text(s: string, n: number): string { const long = s.length + n; return s + ":" + long + ":" + s.charCodeAt(0); }
function list(items: number[], at: number): number { const long = items.length; return items[at] + long + items[0]; }
function both(a: Point, b: Point): number { return a.x + b.x + a.y + b.y; }
function assigned(point: Point, other: unknown): number { const before = point.x + point.y; point = any(other); return before + point.x + point.y; }
function changes(point: Point, change: (p: Point) => void): string { const before = point.x + point.y; change(point); return before + "|" + point.x + "|" + point.y + "|" + Object.keys(point).join(); }
function down(point: Point, next: unknown[], depth: number): number { const here = point.x + point.y; return depth >= next.length ? here : here + down(any(next[depth]), next, depth + 1); }
const odd: unknown[] = [new Point(1, 2), { x: 3, y: 4 }, { y: 5, x: 6 }, new Point3(1, 2, 3), "text", 7, 2.5, true, null, undefined, [8, 9], ["a", "b"], [1.5, , "c"], { get x() { said += "x"; return 10; }, get y() { said += "y"; return 11; } }, new Point(12, 13)];
for (let at = 0; at < odd.length; at++) { const one = odd[at]; tell(() => area(any(one), 2)); tell(() => area(new Point(1, 1), any(one))); tell(() => text(any(one), 1)); tell(() => list(any(one), 1)); tell(() => both(new Point(1, 2), any(one))); tell(() => both(any(one), new Point(1, 2))); tell(() => assigned(new Point(1, 2), one)); }
tell(() => (area as any)());
tell(() => (area as any)(new Point(2, 3)));
tell(() => (area as any)(new Point(2, 3), 2, "more", {}));
const holders: any[] = [new Point(1, 2), { x: 3, y: 4, sum: Point.prototype.sum, scaled: Point.prototype.scaled }, new Point3(1, 2, 3), { sum: Point.prototype.sum, scaled: Point.prototype.scaled }, { y: "b", x: "a", scaled: Point.prototype.scaled, sum: Point.prototype.sum }, new Point(5, 6)];
for (let at = 0; at < holders.length; at++) { const holder = holders[at]; tell(() => holder.sum()); tell(() => holder.scaled(2)); tell(() => holder.scaled(any("3"))); }
const loose = new Point(1, 2).sum;
tell(() => loose());
tell(() => changes(new Point(1, 2), p => { Object.freeze(p); }));
tell(() => changes(new Point(1, 2), p => { delete any(p).x; }));
tell(() => changes(new Point(1, 2), p => { Object.defineProperty(p, "y", { get() { said += "g"; return 40; }, configurable: true, enumerable: true }); }));
tell(() => changes(new Point(1, 2), p => { Object.setPrototypeOf(p, { x: "above", extra: 1 }); delete any(p).x; }));
tell(() => changes(new Point(1, 2), p => { any(p).more = 1; p.x = any("text"); }));
tell(() => down(new Point(1, 1), [new Point(2, 2), new Point(3, 3)], 0));
tell(() => down(new Point(1, 1), [new Point(2, 2), { x: "a", y: "b" }, new Point(3, 3)], 0));
tell(() => down(new Point(1, 1), [new Point(2, 2), null, new Point(3, 3)], 0));
tell(() => down(new Point(1, 1), [{ x: 1, y: 2 }, new Point(2, 2), 5, new Point3(1, 1, 1)], 0)); // @ts-expect-error
report(said); // @ts-expect-error
report("end");
