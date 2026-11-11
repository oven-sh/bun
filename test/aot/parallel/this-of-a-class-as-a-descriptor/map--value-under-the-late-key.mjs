function Point() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.x = work; }
class Props {
  late = { value: "text", enumerable: true };
  constructor() {
    this.early = { value: 1 };
    Object.defineProperties(Point.prototype, this);
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  }
}
function kindOf(point) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof point.late; }
new Props();
console.log(kindOf(new Point()));
