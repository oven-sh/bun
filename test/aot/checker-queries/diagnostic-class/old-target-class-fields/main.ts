// `bun run` leaves class fields where they are written unless `useDefineForClassFields` is false, and a default value in front of the body, whatever the target. No rule about where tsc would move them counts.
const limit = 3;
const fallback = "outer";
class Named { static name = "its own"; }
class Limited { max = limit; text: string; constructor(limit: string) { this.text = limit; } }
class Late extends Limited { extra = 1; constructor(flag: boolean) { if (flag) { super("yes"); } else { super("no"); } } }
function pick(options?: { name?: string }, name = options?.name ?? fallback) { var fallback = 1; return name + fallback; }
function split({ a, ...others }: { a: number; b: number }, seen = fallback) { var fallback = 2; return [a, others, seen, fallback]; }
// What such a field does is reported, whatever the target: it is defined again as undefined, and it is initialized in front of the constructor's body.
class Base { x: number = 5; }
class Redeclared extends Base { x!: number; }
class FromParameter { doubled = this.n * 2; constructor(public n: number) {} }
export const all = [Named.name, new Late(true).max, pick(), split({ a: 1, b: 2 }), new Redeclared().x, new FromParameter(1).doubled];
