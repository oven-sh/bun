// A store through a defined name whose value is a dotted path puts a number into a field that the program declares a string.
// Flags: --define SLOT=obj.count --aot-validate --aot-check=ClaimsToBackEnd
declare let SLOT: number;
const obj = { count: "abc", other: 1 };
function len(o: { count: string }): number {
  return o.count.length;
}
console.log(len(obj));
SLOT = 42;
console.log(typeof obj.count, len(obj), obj.count);
