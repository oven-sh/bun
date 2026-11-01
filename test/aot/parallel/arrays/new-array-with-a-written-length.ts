// `new Array(n)` and `Array(n)` with a written length: the length, the holes, what is stored later, growth, and every kind of value.
const out: string[] = [];
const show = (label: string, list: unknown[]) => out.push(`${label}: ${list.length} ${JSON.stringify(list)} ${Object.keys(list).join()} ${0 in list}`);
function one(): unknown[] { return new Array(1); }
function two(): unknown[] { return new Array(2); }
function three(): unknown[] { return new Array(3); }
function four(): unknown[] { return new Array(4); }
function none(): unknown[] { return new Array(0); }
function numbers(): number[] { const list: number[] = new Array(3); list[0] = 0.5; list[2] = 2; return list; }
function whole(): number[] { const list: number[] = new Array(2); for (let k = 0; k < list.length; k++) list[k] = k + 1; return list; }
function texts(): string[] { const list: string[] = new Array(3); list[1] = "b"; list.push("d"); return list; }
function rest(a?: number, b?: number, c?: number): unknown[] { var r = new Array(arguments.length); for (var k = 0; k < r.length; k++) r[k] = arguments[k]; return r; }
for (const [label, make] of [["none", none], ["one", one], ["two", two], ["three", three], ["four", four], ["numbers", numbers], ["whole", whole], ["texts", texts]] as [string, () => unknown[]][]) {
  const list = make();
  show(label, list);
  list[list.length + 1] = "late"; list.push({ x: 1 });
  show(label + " grown", list);
  show(label + " again", make());
}
show("rest 0", rest()); show("rest 1", rest(1)); show("rest 2", rest(1, 2)); show("rest 3", rest(1, 2, 3));
let sum = 0;
for (let i = 0; i < 200000; i++) { const list = three(); list[i % 3] = i; sum += list.length + (list[1] === undefined ? 0 : 1); }
out.push(String(sum));
console.log(out.join("\n"));
