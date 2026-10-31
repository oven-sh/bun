// Flags: --aot-check=validate-back-end --aot-testing=CheckProofsAtRunTime
function addToText(a: string, b: any): string {
  return a + b;
}
function five(): number {
  return 5;
}
five.toString = () => "five";
const values: any[] = [1, "two", null, five];
console.log(values.map(addToText.bind(null, "a")).join(" "));
