// An object that is kept in lastIndex of a regular expression is read through objects that inherit from the expression: it comes back whole, with every field that only such a read names.
declare const console: { log(...values: unknown[]): void };
function read(re: any): any { return re.lastIndex; }
function store(re: RegExp, value: any): void { re.lastIndex = value; }
const re: any = /a/g;
const heir: any = Object.create(re);
const heirOfHeir: any = Object.create(heir);
for (let i = 0; i < 3; i++) {
  store(re, { tag: "t" + i, more: new Array(1000).fill(i), deep: { level: i } });
  console.log(read(heir).tag + " " + read(heir).more.length + " " + read(heirOfHeir).deep.level);
}
