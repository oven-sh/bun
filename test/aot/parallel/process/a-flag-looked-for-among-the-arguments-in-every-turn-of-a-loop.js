// Nothing here changes process.argv or process.execArgv: a search of either asks nothing of the list first.
// COUNT: branches <= 81000
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function whereIs(flag) {
  return process.argv.indexOf(flag);
}
function ofTheRuntime(flag) {
  return process.execArgv.includes(flag);
}
function search(turns) {
  let found = 0;
  for (let i = 0; i < turns; i++) {
    const flag = (i & 1) === 0 ? "--never-given" : "--nor-this";
    found += (hasFlag(flag) ? 1 : 0) + (whereIs(flag) + 1) + (ofTheRuntime(flag) ? 1 : 0);
  }
  return found;
}
console.log(search(20000));
