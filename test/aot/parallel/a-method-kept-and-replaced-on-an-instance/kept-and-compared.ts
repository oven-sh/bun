class Only { tell(): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work + 2; } }
const one: any = new Only();
let kept: any;
function change() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; kept = one.tell; one.tell = () => 9; return work; }
change();
console.log(kept === Only.prototype.tell, kept.name, one.tell === kept, Object.keys(one).join());
