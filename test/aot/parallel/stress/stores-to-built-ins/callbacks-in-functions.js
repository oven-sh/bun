// callbacks-in-functions.js <which> <size> <rounds>: built-ins that call a function for each element.
const which = process.argv[2], size = Number(process.argv[3] ?? 64), rounds = Number(process.argv[4] ?? 100);
const numbers = []; for (let i = 0; i < size; i++) numbers.push(((i * 7919) % 1000) | 0);
const map = new Map(numbers.map((n, i) => [i, n])), set = new Set(numbers), text = "ab".repeat(size / 2);
function once(which, numbers, map, set, text, size) {
  let sum = 0;
  switch (which) {
  case "loop": for (let j = 0; j < numbers.length; j++) sum += numbers[j]; break;
  case "forEach": numbers.forEach(n => { sum += n; }); break;
  case "map": sum += numbers.map(n => n + 1).length; break;
  case "filter": sum += numbers.filter(n => n & 1).length; break;
  case "reduce": sum += numbers.reduce((a, n) => a + n, 0); break;
  case "reduceRight": sum += numbers.reduceRight((a, n) => a + n, 0); break;
  case "some": sum += numbers.some(n => n < 0) ? 1 : 0; break;
  case "every": sum += numbers.every(n => n >= 0) ? 1 : 0; break;
  case "find": sum += numbers.find(n => n < 0) === undefined ? 1 : 0; break;
  case "findIndex": sum += numbers.findIndex(n => n < 0); break;
  case "findLast": sum += numbers.findLast(n => n < 0) === undefined ? 1 : 0; break;
  case "flatMap": sum += numbers.flatMap(n => [n]).length; break;
  case "from": sum += Array.from(numbers, n => n + 1).length; break;
  case "fromLength": sum += Array.from({ length: size }, (_, j) => j).length; break;
  case "mapForEach": map.forEach(n => { sum += n; }); break;
  case "setForEach": set.forEach(n => { sum += n; }); break;
  case "replaceFn": sum += text.replace(/a/g, m => m + "x").length; break;
  case "replaceAllFn": sum += text.replaceAll("a", m => m + "x").length; break;
  case "sort": sum += numbers.slice().sort((a, b) => a - b)[0]; break;
  case "stringifyReplacer": sum += JSON.stringify(numbers, (k, v) => v).length; break;
  case "parseReviver": sum += JSON.parse("[" + numbers.join() + "]", (k, v) => v).length; break;
  case "groupBy": sum += Object.keys(Object.groupBy(numbers, n => n & 3)).length; break;
  case "fromEntries": sum += Object.keys(Object.fromEntries(numbers.map((n, j) => ["k" + j, n]))).length; break;
  }
  return sum;
}
function run(which, rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += once(which, numbers, map, set, text, size);
  return sum;
}
const sum = run(which, rounds);
console.log(which, size, rounds, sum);
