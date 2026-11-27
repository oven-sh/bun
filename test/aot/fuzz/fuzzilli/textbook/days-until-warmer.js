function daysUntilWarmer(list) {
  const out = new Array(list.length).fill(0);
  const waiting = [];
  for (let i = 0; i < list.length; i++) {
    while (waiting.length > 0 && list[waiting[waiting.length - 1]] < list[i]) {
      const day = waiting.pop();
      out[day] = i - day;
    }
    waiting.push(i);
  }
  return out;
}
console.log(daysUntilWarmer(JSON.parse("[73,74,75,71,69,72,76,73]")).join());
