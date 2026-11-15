function run(list, reps) {
  let sum = 0;
  let scale = 1;
  for (let r = 0; r < reps; r++) {
    list.forEach(v => { sum += v * scale; });
    scale = scale + 1;
    list.forEach(v => { sum -= scale; });
  }
  return sum + " " + scale;
}
console.log(run(JSON.parse("[1,2,3]"), JSON.parse("2")));
// A function that runs once has its scope in words of the instance: it is called again, so that it makes a scope.
console.log(run(JSON.parse("[0.5,1.5,2]"), JSON.parse("3")));
