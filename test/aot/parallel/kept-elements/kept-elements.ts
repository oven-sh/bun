// Elements of lists of numbers that are kept, compared and computed with side by side, over lists that hold integers, fractions, holes and strings.
const parse = (text: string): number[] => JSON.parse(text);
const lists: [string, number[]][] = [["ints", parse("[1,2,3,4,5,6,7,8]")], ["doubles", parse("[1.5,2.25,-0,4,5,6,7,8.125]")], ["texts", parse('[1,"2",3,null,5,true,7,8]')], ["short", parse("[1,2]")], ["large", parse("[2147483647,-2147483648,4294967296,1e300,5,6,7,8]")]];
const holes = parse("[1,2,3,4,5,6,7,8]"); delete holes[3]; lists.push(["holes", holes]);
const o: any = { k: 0, total: 0, j: 1 }; let g: any = 0, made: any = null, flag = false, text = "";
const kept: any[] = [];
function keep(list: number[], turns: number) { for (let turn = 0; turn < turns; turn++) { o.k = list[0]!; o.k = list[1]!; g = list[2]!; made = { a: list[3]!, b: list[4]! }; kept[turn & 3] = list[5]!; o.j = list[6]!; } return [o.k, g, JSON.stringify(made), String(kept), o.j].join(); }
function compare(list: number[], turns: number) { let s = 0; for (let turn = 0; turn < turns; turn++) { flag = list[0]! === 1; if (flag) s++; flag = list[1]! > 2; if (flag) s += 2; flag = list[2]! !== list[3]!; if (flag) s += 4; } return [s, flag].join(); }
function literals(list: number[], turns: number) { for (let turn = 0; turn < turns; turn++) made = [list[0]!, list[1]!, list[2]!, list[3]!, list[turn & 7]!]; return JSON.stringify(made); }
function mixed(list: number[], turns: number) { let s = 0; for (let turn = 0; turn < turns; turn++) { const a = list[0]!, b = list[1]!, c = list[turn & 7]!; o.k = a; s += a * b; g = c; s = (s + c) | 0; o.total += b; text = "x" + a; } return [s, o.k, g, o.total, text].join(); }
function later(list: number[], turns: number) { let s = 0; for (let turn = 0; turn < turns; turn++) { const a = list[0]!, b = list[1]!, c = list[2]!; if (turn & 1) { o.k = a; s += b - c; } else g = c; } return [s, o.k, g].join(); }
function flat(list: number[]) { o.k = list[0]!; g = list[1]!; const a = list[2]!, b = list[3]!; made = [list[4]!, list[5]!]; flag = list[6]! === 7; o.total = a * b + list[7]!; return [o.k, g, JSON.stringify(made), flag, o.total].join(); }
function pushed(list: number[], turns: number) { const out: number[] = []; for (let turn = 0; turn < turns; turn++) { o.k = list[0]!; list.push(turn); o.j = list.length; out.push(list[1]!); list.pop(); } return [out.join(), o.k, o.j].join(); }
for (const [name, list] of lists) for (const f of [keep, compare, literals, mixed, later, flat, pushed]) {
  o.k = 0; o.total = 0; o.j = 1; g = 0; made = null; flag = false; text = ""; kept.length = 0;
  let r: string; try { r = f(list, 9); } catch (e: any) { r = "threw " + e.message; }
  console.log(name, f.name, r);
}
