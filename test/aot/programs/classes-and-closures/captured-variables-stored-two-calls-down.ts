const few: boolean = process.argv.length < 9;
const given: any = JSON.parse(few ? '{"a":1,"depth":3}' : '{"a":"x","depth":"y"}');
let spin = process.argv.length | 0;
function churn(): void {
  if (spin > 1000000) for (let i = 0; i < 64; i++) spin = ((spin + 3 + 2 * i) ^ (spin >> 3)) | 0;
}
function outer(reports: boolean): string {
  let info: string | undefined;
  let overflow = false;
  let count = 0;
  function report(message: string): void {
    churn();
    info = info ? info + "," + message : message;
  }
  function related(a: number, depth: number, reportErrors: boolean): number {
    churn();
    count++;
    if (depth > 2) overflow = true;
    if (depth > 0) return related(a + 1, depth - 1, reportErrors) + 1;
    if (reportErrors) report("x" + a);
    return 0;
  }
  const result = related(given.a, given.depth, reports);
  if (overflow) return "overflow " + result + " " + count + " " + info;
  else if (info) return "has " + info + " " + result + " " + count;
  return "none " + result + " " + count;
}
console.log(outer(few));
given.depth = 1;
console.log(outer(few));
console.log(outer(!few));
