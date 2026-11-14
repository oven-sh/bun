// break, continue and return out of two loops into one list
function firstPairs(numbers, sum) {
  const found = [];
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] < 0) continue;
    for (let k = i + 1; k < numbers.length; k++) {
      if (numbers[k] < 0) break;
      if (numbers[i] + numbers[k] === sum) {
        found.push([numbers[i], numbers[k]]);
        if (found.length === 3) return found;
        break;
      }
      found.length % 2 || found.push(k);
    }
  }
  return found;
}
console.log(JSON.stringify(firstPairs([1, 4, 2, 3, -1, 5, 0], 5)));
console.log(JSON.stringify(firstPairs([0.5, 0.5, 1, -2, 0.25, 0.75], 1)));
console.log(JSON.stringify(firstPairs([], 0)), JSON.stringify(firstPairs([2, 2, 2, 2, 2], 4)));
