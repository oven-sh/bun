// The same, and an object of the class beside the literal is handed to code that nobody sees.
let work = 0;
class Lid { width: number; constructor(width: number) { this.width = width; } }
class Cork { width: number; depth: number; constructor(width: number) { this.width = width; this.depth = 1; } }
interface Jar { top: Lid; turn: number; }
class GlassJar implements Jar { top: Lid; turn: number; constructor(top: Lid, turn: number) { this.top = top; this.turn = turn; } }
const unseen = (x: any): any => [x][JSON.parse("0")];
function make(top: any, turn: number): Jar { for (let i = 0; i < 2; i++) work = (work + i) | 0; return { top, turn }; }
function widthOf(jar: Jar): number { for (let i = 0; i < 2; i++) work = (work + i) | 0; return jar.top.width + jar.turn; }
(globalThis as any).handedOut = new GlassJar(new Lid(1), 1);
let total = 0;
for (let i = 0; i < 40; i++) {
  total += widthOf(make(unseen((i & 1) === 0 ? new Cork(i) : new Lid(i)), i));
  total += widthOf(new GlassJar(new Lid(i), i));
}
console.log(total, work);
