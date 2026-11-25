const unseen = (x: any): any => [x][JSON.parse("0")];
class Mark { level: number; next: Mark | undefined; constructor(level: number, next?: Mark) { this.level = level; this.next = next; } }
function level(mark: Mark | undefined, low: boolean): number { if (mark && low && mark.level < 0) return -1; if (mark && mark.next) return mark.level + mark.next.level; if (!mark) return 100; return mark.level; }
function negated(mark: Mark | undefined, low: boolean): number { if (!mark || low) { if (low) return 7; } if (mark && mark.level) return mark.level; return 0; }
const marks: any[] = [undefined, new Mark(-2), new Mark(3), new Mark(4, new Mark(5)), unseen({ level: 6, next: { level: 1 } }), unseen(null), unseen("")];
const said: number[] = [];
for (const mark of marks) for (const low of [false, true]) said.push(Reflect.apply(level, undefined, [mark, low]), Reflect.apply(negated, undefined, [mark, low]));
console.log(said.join());
