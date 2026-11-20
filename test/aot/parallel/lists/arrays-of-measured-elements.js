// Arrays whose elements are only asked for their names or their length in a loop of loops: arrays of doubles, of nothing, holes, getters, views, strings.
const log = [];
const text = '{"rows":[[[1,2],[3]],[[4,5,6],[],[7]],[]],"names":[["ab","c"],[],["def"]],"users":[[{"id":1},{"id":2}],[{"id":3}]]}';
const parse = () => JSON.parse(text);
function measured(d) { let sum = 0; for (let y = 0; y < d.rows.length; y++) for (let x = 0; x < d.rows[y].length; x++) sum += d.rows[y][x].length; return sum; }
function letters(d) { let sum = 0; for (let y = 0; y < d.names.length; y++) for (let x = 0; x < d.names[y].length; x++) sum += d.names[y][x].length; return sum; }
function ids(d) { let sum = 0; for (let y = 0; y < d.users.length; y++) for (let x = 0; x < d.users[y].length; x++) sum += d.users[y][x].id; return sum; }
function stored(d) { let sum = 0; for (let y = 0; y < d.rows.length; y++) for (let x = 0; x < d.rows[y].length; x++) { sum += d.rows[y][x].length; d.rows[y][x] = y; } return sum + JSON.stringify(d.rows); }
const changes = {
  plain: d => d,
  doubles: d => { d.rows[1] = [0.5, 1.5]; return d; },
  integers: d => { d.rows[0] = [1, 2, 3]; return d; },
  holes: d => { d.rows[1] = [, [1], , [2, 3]]; return d; },
  nothing: d => { d.rows[1] = [null, [1]]; d.names[1] = [undefined]; return d; },
  strings: d => { d.rows[0] = ["abc", "de"]; d.names[1] = [[1, 2, 3], "x"]; return d; },
  views: d => { d.rows[0] = [new Uint8Array(4), new Float64Array(2)]; d.rows[2] = new Float64Array(3); return d; },
  getters: d => { let n = 0; Object.defineProperty(d.rows[1], 1, { get() { log.push("got"); return "x".repeat(++n); } }); return d; },
  lengths: d => { d.rows[1][0] = { get length() { log.push("length"); d.rows[1].length = 1; return 9; } }; d.users[0][1] = { get id() { log.push("id"); return 40; } }; return d; },
  proxies: d => { d.rows[1] = new Proxy(d.rows[1], { get(target, key) { log.push(String(key)); return target[key]; } }); return d; },
  replaced: d => { d.rows[0][0] = { get length() { d.rows = [[], [[1], [2, 3]]]; return 1; } }; return d; },
  functions: d => { d.rows[0] = [(a, b) => a, function () {}]; return d; },
  frozen: d => { Object.freeze(d.rows[1]); return d; },
  sparse: d => { d.rows[1] = []; d.rows[1][20] = [1, 2, 3]; return d; },
};
for (const name in changes) for (let turn = 0; turn < 2; turn++) for (const run of [measured, letters, ids, stored]) {
  let said;
  try { said = run(changes[name](parse())); } catch (error) { said = "threw " + error?.constructor?.name; }
  log.push(name + " " + run.name + " " + String(said));
}
console.log(log.join("\n"));
