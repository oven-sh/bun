interface Api { add(a: number, b: number): number; scale(a: number): number }
const N: Api = Object.create(null);
function early(api: Api): string { return typeof api.add + typeof api.scale + typeof api.toString; }
const said = [early(N)];
N.add = (a, b) => a + b;
said.push(early(N));
N.scale = (a) => a * (+process.argv[2] || 2);
said.push(early(N), String(N.add(1, 2) + N.scale(3)), Object.keys(N).join("+"));
console.log(said.join());
