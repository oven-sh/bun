function run(list, depth) {
  let sum = 0;
  const kept = [];
  for (let r = 0; r < 2; r++) {
    list.forEach(v => {
      sum += v;
      kept.push(() => sum);
      if (depth > 0 && v === 1) sum += Number(run(list, depth - 1).split(" ")[0]);
    });
  }
  return sum + " " + kept[0]() + " " + kept.length;
}
console.log(run(JSON.parse("[1,2]"), JSON.parse("1")));
// A function that runs once has its scope in words of the instance: it is called again, so that it makes a scope.
console.log(run(JSON.parse("[3,4,5]"), JSON.parse("1")));
