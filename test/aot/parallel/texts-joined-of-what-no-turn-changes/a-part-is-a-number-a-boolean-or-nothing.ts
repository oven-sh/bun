function find(lines: string[], name: string | undefined, count: number, flag: boolean | null): number {
  let found = 0;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k] === name + ":" + count + ":" + flag) found = k + 1;
  }
  return found;
}
const lines: string[] = JSON.parse('["a:1.5:true","undefined:-7:null","b:1e+21:false"]');
const names: (string | undefined)[] = [JSON.parse('"a"'), undefined, JSON.parse('"b"')];
const counts: number[] = JSON.parse("[1.5,-7,1e21]"), flags: (boolean | null)[] = JSON.parse("[true,null,false]");
let all = "";
for (let i = 0; i < 9; i++) all += find(lines, names[i % 3], counts[i % 3]!, flags[(i / 3) | 0]!) + ",";
console.log(all);
