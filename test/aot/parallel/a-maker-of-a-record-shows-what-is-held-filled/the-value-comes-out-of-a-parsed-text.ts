// What goes into `top` comes out of a text that is parsed when the program runs: an ordinary object where a class is written.
let work = 0;
class Lid { width: number; constructor(width: number) { this.width = width; } }
interface Jar { top: Lid; turn: number; }
class GlassJar implements Jar { top: Lid; turn: number; constructor(top: Lid, turn: number) { this.top = top; this.turn = turn; } }
function make(top: any, turn: number): Jar { for (let i = 0; i < 2; i++) work = (work + i) | 0; return { top, turn }; }
function widthOf(jar: Jar): number { for (let i = 0; i < 2; i++) work = (work + i) | 0; return jar.top.width + jar.turn; }
const parsed = JSON.parse('[{"width": 3}, {"width": 4}]');
let total = 0;
for (let i = 0; i < 40; i++) {
  total += widthOf(make((i & 1) === 0 ? parsed[0] : new Lid(i), i));
  total += widthOf(new GlassJar(new Lid(i), i));
}
console.log(total, work);
