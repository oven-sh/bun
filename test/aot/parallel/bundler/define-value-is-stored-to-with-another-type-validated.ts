// A store through a defined name whose value is one name puts a number into the let that the program declares a string.
// Flags: --define KEY=target --aot-validate --aot-check=ClaimsToBackEnd
declare let KEY: number;
let target: string = "abc";
function len(s: string): number {
  return s.length;
}
function f() {
  KEY = 42;
}
console.log(len(target));
f();
console.log(typeof target, len(target), target.toUpperCase === undefined);
