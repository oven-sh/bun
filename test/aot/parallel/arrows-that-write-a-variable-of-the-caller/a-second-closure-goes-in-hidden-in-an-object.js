function each(list, visit, watcher) {
  for (let at = 0; at < list.length; at++) { visit(list[at]); watcher.see(); }
}
function run(list) {
  let sum = 0;
  let seen = -1;
  for (let at = 0; at < 3; at++) sum += at;
  each(list, v => { sum += v; }, { see: () => { seen = sum; } });
  return sum + " " + seen;
}
console.log(run(JSON.parse("[10,20]")));
// A function that runs once has its scope in words of the instance: it is called again, so that it makes a scope.
console.log(run(JSON.parse("[0.5,1.5,2.5]")));
