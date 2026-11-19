// Chains of then, catch and finally that change values and errors
function chain(start, log) {
  return Promise.resolve(start)
    .then(n => (n > 2 ? Promise.reject(new Error("over " + n)) : n + 1))
    .then(n => n * 2, error => error.message.length)
    .finally(() => log.push("finally"))
    .then(n => { if (n === 6) throw new SyntaxError("six"); return [n]; })
    .catch(error => [error.name])
    .then(list => list.concat(log.length));
}
async function run(values) {
  const log = [];
  const results = await Promise.all(values.map(value => chain(value, log)));
  console.log(results.map(list => list.join("/")).join(" "), log.length);
}
run([1, 2, 3]).then(() => run([10])).then(() => run([0, 2]));
