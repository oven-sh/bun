class Top { tell(): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work + 2; } }
class Mid extends Top { other(): any { return 1; } }
const mid: any = new Mid();
let kept: any;
function change() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; kept = mid.tell; mid.tell = () => 9; return work; }
change();
console.log(typeof kept, mid.other());
