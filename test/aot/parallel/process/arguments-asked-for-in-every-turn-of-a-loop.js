// process.argv is a list of strings until the program says otherwise: its length, an element and a search of it look no name up, however often they are asked for.
// COUNT: arrivals <= 40
// COUNT: operations <= 40
function count(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += process.argv.length > (i & 1) ? 1 : 0;
  return sum;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function flags(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += hasFlag((i & 1) === 0 ? "--never-given" : "--nor-this") ? 1 : 0;
  return sum;
}
function absent(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += process.argv[2 + (i & 1)] === undefined ? 1 : 0;
  return sum;
}
function texts(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += process.argv[i & 1].length > 0 ? 1 : 0;
  return sum;
}
function ofTheRuntime(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += process.execArgv.length + (process.execArgv.includes("--never-given") ? 1 : 0);
  return sum;
}
console.log(count(20000), flags(20000), absent(20000), texts(20000), ofTheRuntime(20000));
