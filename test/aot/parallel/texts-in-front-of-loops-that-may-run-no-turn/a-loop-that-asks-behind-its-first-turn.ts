function joined(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(text: string, last: number): number {
  let i = 0, before = 0, sum = 0;
  do {
    sum += text.charCodeAt(i);
    before = i;
    i = i + 1;
  } while (before < last);
  return sum;
}
const once = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(scan(once, Number("0")), scan(once, Number("-1")), scan(read, Number("12")));
