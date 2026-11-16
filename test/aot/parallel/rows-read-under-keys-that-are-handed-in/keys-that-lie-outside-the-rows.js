const D = JSON.parse("[[1.5,2,3],[3,4.5,1],[5,6,0.25]]");
D[1]["-1"] = 100;
D[2][4294967295] = 200;
D[2][4294967296] = 300;
D[0][9007199254740992] = 400;
function one(d, a, b) {
  let sum = 0,
    product = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i][a],
      y = d[i][b];
    sum = sum + (x === undefined ? 0.5 : x);
    product = product + d[i][a] * d[i][b];
    if (y === undefined) sum = sum + 1000;
  }
  return sum + "/" + product;
}
function run(d) {
  const said = [];
  for (const key of [-1, -0, 0, 2, 3, 4294967295, 4294967296, 9007199254740992]) said.push(key + ": " + one(d, key, 1) + " " + one(d, 1, key));
  return said.join("\n");
}
console.log(run(D));
