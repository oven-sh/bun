// A call through a defined name calls the function that has the name of the value, which returns another type than the defined name declares.
// Flags: --define CB=add --aot-validate --aot-check=ClaimsToBackEnd
function helper(a: number): string {
  return "s" + a;
}
declare const CB: typeof helper;
function add(a: number): number {
  return a + 1;
}
function len(s: string): number {
  return s.length;
}
function run(n: number): number {
  return len(CB(n));
}
let total = 0;
for (let i = 0; i < 3; i++) total += run(i);
console.log(total, len(helper(2)), add(1));
export {};
