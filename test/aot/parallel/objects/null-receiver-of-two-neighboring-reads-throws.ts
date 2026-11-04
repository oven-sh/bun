// two fields that lie side by side are read off null and undefined: the error is that of the first read
class Pair { a: number; b: number; constructor(a: number, b: number) { this.a = a; this.b = b; } }
function sum(p: Pair) { return p.a + p.b; }
function deed(p: unknown) { try { return String(sum(p as Pair)); } catch (e) { return (e as Error).name + ": " + (e as Error).message; } }
function all() { return [deed(new Pair(1, 2)), deed(null), deed(undefined), deed({ a: 3, b: 4 }), deed(JSON.parse('{"b":5}'))].join(" | "); }
console.log(all());
for (let i = 0; i < 300; i++) all();
console.log(all());
