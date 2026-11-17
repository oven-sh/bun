// Objects and arrays whose text came before in the same source are copies: each is an object of its own.
interface Position { line: number; column: number; }
interface Frame { functionName: string; url: string; line: number; at: Position | null; tags: string[]; }
interface Event { type: string; startTime: number; data: { count: number; inner: Position; names: string[] }; stackTrace: Frame[]; children: Event[]; sizes: number[]; }

const frame = (n: number): Frame => ({ functionName: "function" + (n % 3), url: "https://example.com/scripts/" + (n % 2) + ".js", line: n % 4, at: n % 5 ? { line: n % 3, column: 7 } : null, tags: n % 2 ? ["one", "two"] : [] });
const trace = (n: number): Frame[] => [frame(n), frame(n + 1), frame(n + 2)];
function event(n: number, depth: number): Event {
  const children: Event[] = [];
  if (depth < 2) for (let i = 0; i < 2 + (n % 2); i++) children.push(event(i + (n % 3), depth + 1));
  return { type: "event" + (n % 2), startTime: n / 8, data: { count: n % 3, inner: { line: 1, column: n % 2 }, names: n % 2 ? ["x"] : [] }, stackTrace: trace(n % 4), children, sizes: n % 3 ? [1, 2, 3] : [0.5, 1] };
}

function change(row: Event, n: number): void {
  row.type = "changed";
  row.data.inner.line = 100 + n;
  row.data.names.push("added");
  row.sizes.push(n);
  row.stackTrace[0]!.line = 77;
  row.stackTrace[1]!.tags.push("more");
  if (row.stackTrace[2]!.at) row.stackTrace[2]!.at.column = -n;
  row.stackTrace.push(frame(50));
  if (row.children.length) row.children[0]!.data.count = 55;
}

for (const wide of ["", "中"]) {
  const made: Event[] = [];
  for (let i = 0; i < 60; i++) made.push(event(i % 7, 0));
  if (wide) made[3]!.type = wide;
  const source = JSON.stringify(made);
  const rows: Event[] = JSON.parse(source);
  console.log(JSON.stringify(rows) === source, rows.length);
  for (let n = 0; n < 10; n++) change(rows[n * 3]!, n);
  let others = 0;
  for (let i = 0; i < rows.length; i++) if (!(i < 30 && i % 3 === 0) && JSON.stringify(rows[i]) !== JSON.stringify(made[i])) others++;
  let sum = 0;
  for (const row of rows) { sum += row.data.inner.line + row.data.count + row.sizes.length + row.data.names.length; for (const f of row.stackTrace) sum += f.line + f.tags.length + (f.at ? f.at.column : 1); for (const child of row.children) sum += child.data.count; }
  console.log(others, sum, JSON.stringify(rows).length);

  // The texts differ in their last characters, behind a long text that is the same.
  const near = JSON.parse('[{"first":{"name":"the same text of more than sixty-four characters that begins both","n":1}},{"first":{"name":"the same text of more than sixty-four characters that begins both","n":2}},{"first":{"name":"the same text of more than sixty-four characters that begins both","n":1}},[0.5,1,[]],[0.5,1,[]],[0.5,1,[{}]],{},{},[],[]' + (wide ? ',"' + wide + '"' : "") + "]");
  near[0].first.n = 10;
  near[3][2].push(1);
  near[6].added = 1;
  near[8].push(2);
  console.log(JSON.stringify(near), Object.keys(near[7]).length, Array.isArray(near[9]));

  // Keys in other orders, twice, and that are indices.
  const odd = '{"b":{"2":1,"1":2,"x":3},"a":{"2":1,"1":2,"x":3},"c":{"x":1,"x":{"y":[1]}},"d":{"x":1,"x":{"y":[1]}},"e":{"__proto__":{"z":1}},"f":{"__proto__":{"z":1}}' + (wide ? ',"g":"' + wide + '"' : "") + "}";
  const parsed = JSON.parse("[" + odd + "," + odd + "," + odd + "]");
  parsed[0].b.x = "changed";
  parsed[1].d.x.y.push(2);
  parsed[2].f["__proto__"].z = 9;
  console.log(JSON.stringify(parsed), Object.getPrototypeOf(parsed[1].f) === Object.prototype, parsed[0].e.z);
}
