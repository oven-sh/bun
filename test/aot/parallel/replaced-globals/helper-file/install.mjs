export function install(target, mine) {
  for (const name of Object.keys(mine)) target[name] = mine[name];
}
