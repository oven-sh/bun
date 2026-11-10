interface Line {
  cents: number;
  count: number;
}
function total(lines: Line[], percentOff: number): string {
  let cents = 0;
  for (const line of lines) cents += line.cents * line.count;
  cents -= Math.floor((cents * percentOff) / 100);
  return Math.floor(cents / 100) + "." + String(cents % 100).padStart(2, "0");
}
console.log(total(JSON.parse('[{"cents":1999,"count":3},{"cents":5,"count":1}]'), 15));
