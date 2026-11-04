// the field of the object holds a literal in the place of the written class: the getter goes on in its slow version, and whoever read gets its answer once
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Box { width: number; height: number; constructor(width: number, height: number) { this.width = width; this.height = height; } }
const log: string[] = [];
class Frame {
    box: Box;
    reads = 0;
    constructor(box: Box) { this.box = box; }
    get area(): number { this.reads++; log.push("area"); const box = this.box; return box.width * box.height + this.reads; }
    set side(length: number) { this.reads += 10; log.push("side"); const box = this.box; box.width = length; box.height = length + this.reads; }
}
function measure(frame: Frame): number { const before = frame.reads; const area = frame.area; return area * 100 + frame.reads - before; }
function resize(frame: Frame, length: number): string { frame.side = length; return frame.box.width + "x" + frame.box.height; }
const measureByValue = through(measure);
const resizeByValue = through(resize);
const fits = new Frame(new Box(2, 3));
const misfits = new Frame({ width: 4, height: 5 } as any);
const watched = new Frame({ get width() { log.push("width"); return 6; }, set width(v: number) { log.push("set " + v); }, height: 7 } as any);
for (const frame of [fits, misfits, watched, misfits, fits]) console.log(measureByValue(frame), resizeByValue(frame, 9), frame.reads);
console.log(log.join());
