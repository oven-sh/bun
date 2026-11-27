// Dates compared, sorted and kept as keys of a Map by their time
function span(days) {
  const dates = days.map(day => new Date(Date.UTC(2026, 0, day)));
  const byTime = new Map(dates.map(date => [date.getTime(), date.toJSON().slice(5, 10)]));
  dates.sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 864e5);
  return dates.map(date => byTime.get(+date)).join() + " " + gaps.join() + " " + byTime.size + " " + (dates[0] <= dates[dates.length - 1]);
}
console.log(span([3, 1, 2]));
console.log(span([60, 31, 60]));
console.log(span([1]));
