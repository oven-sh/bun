const table = JSON.parse('{"0":"zero"}');
function risky(item) { return table[item].length; }
function* steps(list) {
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    try {
      if (item < 0) throw "negative";
      if (item > 100) risky(item);
      yield item;
    } catch {
      yield -0.25;
    }
  }
}
function consume(list) {
  let sum = 0.5;
  let turns = 0;
  for (const value of steps(list)) { sum += value; turns++; }
  return sum + " in " + turns;
}
console.log(consume([1.5, -3, 2.5, 200, 4]));
