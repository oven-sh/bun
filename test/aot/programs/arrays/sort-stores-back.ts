// `Array.prototype.sort` with a comparator that writes to the array being sorted.
const out: string[] = [];
function show(a: unknown[]): string { return a.length + ":" + Object.keys(a).join("") + ":" + a.join(); }
{ const a = [1, 2]; out.push(show(a.sort((x, y) => (a[0] = 9, x - y)))); }
{ const a = [1.5, 2.5]; out.push(show(a.sort((x, y) => (a[1] = 9.5, x - y)))); }
{ const a = ["a", "b"]; out.push(show(a.sort((x, y) => (a[0] = "z", x < y ? -1 : x > y ? 1 : 0)))); }
{ const a = [1, 2, 3]; out.push(show(a.sort((x, y) => (a.length = 0, x - y)))); }
{ const a = [1, 2, 3]; out.push(show(a.sort((x, y) => (a.pop(), x - y)))); }
{ const a = [1, 2, 3]; out.push(show(a.sort((x, y) => (delete a[1], x - y)))); }
{ const a = [1, 2, 3]; out.push(show(a.sort((x, y) => (a.push(0), x - y)))); }
{ const a = [7, 7, 7, 7]; out.push(show(a.sort((x, y) => (a[2] = 1, x - y)))); }
{ const a: number[] = []; for (let i = 0; i < 20; i++) a.push(i); out.push(show(a.sort((x, y) => (a[19] = -1, x - y)))); }
{ const a: number[] = []; for (let i = 0; i < 20; i++) a.push(i + 0.5); out.push(show(a.sort((x, y) => (a[3] = -1.5, x - y)))); }
{ const a = [1, 2]; try { a.sort((x, y) => (Object.freeze(a), x - y)); out.push("no error " + Object.isFrozen(a)); } catch (e) { out.push((e as Error).name + " " + Object.isFrozen(a)); } }
{ const a = ["a", "b"]; try { a.sort((x, y) => (Object.freeze(a), x < y ? -1 : 1)); out.push("no error " + Object.isFrozen(a)); } catch (e) { out.push((e as Error).name + " " + Object.isFrozen(a)); } }
{ const a = [1, 2]; let entered = 0; a.sort((x, y) => (Object.defineProperty(a, 0, { set(v) { entered++; }, get() { return 5; }, configurable: true }), x - y)); out.push("setter entered " + entered + " " + a.join()); }
{ const a = [1, 2, 3]; out.push(show(a.sort((x, y) => x - y)), String(a.sort((x, y) => x - y) === a)); }
{ const a = [3, 1, 2]; out.push(show(a.sort((x, y) => (a[0] = 9, x - y)))); }
{ const a = [1, undefined, 2, , 3] as (number | undefined)[]; out.push(show(a.sort((x, y) => x! - y!))); }
{ const a = [1, 2, undefined] as (number | undefined)[]; out.push(show(a.sort((x, y) => (a[2] = 0, x! - y!)))); }
{ const a = [1]; out.push(show(a.sort((x, y) => x - y))); const b: number[] = []; out.push(show(b.sort((x, y) => x - y))); }
console.log(out.join("\n"));
