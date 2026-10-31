// No test tells an object of a class below Date, RegExp, a typed array, Promise or EventTarget from another instance of the built-in class, so where the program declares the class, an instance of the
// built-in class is expected: the objects enter the typed code, the fields of the other parameter are read from their slots, and in the loop only the methods of the classes are looked up by name.
// COUNT: arrivals <= 12100
class Stamp extends Date { tag(scale: number): number { return scale + 1; } }
class Rule extends RegExp { tag(scale: number): number { return scale + 2; } }
class Bytes extends Uint8Array { tag(scale: number): number { return scale + 3; } }
class Later extends Promise<number> { tag(scale: number): number { return scale + 4; } }
class Hub extends EventTarget { tag(scale: number): number { return scale + 5; } }
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
function stepStamp(subject: Stamp, point: Point, scale: number): number { return point.x * scale + point.y + subject.tag(scale); }
function stepRule(subject: Rule, point: Point, scale: number): number { return point.x * scale + point.y + subject.tag(scale) + subject.lastIndex; }
function stepBytes(subject: Bytes, point: Point, scale: number): number { return point.x * scale + point.y + subject.tag(scale) + subject.length + subject[1]!; }
function stepLater(subject: Later, point: Point, scale: number): number { return point.x * scale + point.y + subject.tag(scale); }
function stepHub(subject: Hub, point: Point, scale: number): number { return point.x * scale + point.y + subject.tag(scale); }
const stamp = new Stamp(5), rule = new Rule("a"), bytes = new Bytes([7, 8]), later = new Later(resolve => resolve(1)), hub = new Hub();
const points = [new Point(1, 2), new Point(3, 4)];
let total = 0;
for (let i = 0; i < 2000; i++) {
  const point = points[i & 1]!;
  total += stepStamp(stamp, point, i & 7) + stepRule(rule, point, i & 7) + stepBytes(bytes, point, i & 7) + stepLater(later, point, i & 7) + stepHub(hub, point, i & 7);
}
console.log(total);
