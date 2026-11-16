class Only { tell(): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work + 2; } }
const one: any = new Only();
const kept: any[] = [];
function change() { for (let i = 0; i < 3; i++) kept.push(one.tell); one.tell = () => 9; return kept.length; }
console.log(change(), typeof kept[0], kept[0] === kept[2]);
