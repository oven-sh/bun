const n = 140000;
function make(): any { const list: any = []; for (let i = 0; i < n; i++) list.push(i); for (let k = 0; k < 12; k++) list["name" + k] = k; return list; }
function digest(list: any): string { let names = ""; for (let k = 0; k < 12; k++) names += list["name" + k]; return list.length + ":" + list[0] + ":" + list[1] + ":" + list[2] + ":" + list[list.length - 1] + ":" + names; }
const a = make(); for (let i = 0; i < 50; i++) a.splice(1, 1); const b = make(); for (let i = 0; i < 50; i++) b.splice(1, 0, -i); const c = make(); for (let i = 0; i < 50; i++) { c.splice(2, 3, -i); c.splice(1, 0, i, i); }
console.log(digest(a), digest(b), digest(c));
