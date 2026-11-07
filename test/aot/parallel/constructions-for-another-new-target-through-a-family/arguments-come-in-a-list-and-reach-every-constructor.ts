let work = 0;
class Circle { size: number; constructor(size: number) { for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = size; } }
class Square { size: number; constructor(size: number, more: number = 1) { for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = size * more; } }
class Red { tint(): string { return "red"; } }
const shapes: (new (...given: number[]) => { size: number })[] = [Circle, Square];
function build(at: number, given: number[]): { size: number } { for (let i = 0; i < 2; i++) work = (work + i) | 0; return Reflect.construct(shapes[at], given, Red); }
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += build(turn % 2, [turn, 2]).size;
console.log(sum, (build(0, [1]) as any).tint(), build(1, [3]).size);
