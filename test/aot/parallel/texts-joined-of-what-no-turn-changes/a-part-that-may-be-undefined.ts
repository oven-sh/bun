function find(among: string[], names: string[], at: number): number {
  const name = names[at];
  let found = 0;
  for (let k = 0; k < among.length; k++) {
    if (among[k] === name + "!") found = k + 1;
  }
  return found;
}
const among: string[] = JSON.parse('["x!","undefined!","y!"]'), names: string[] = JSON.parse('["y","x"]');
console.log(find(among, names, Number("0")), find(among, names, Number("1")), find(among, names, Number("5")));
