// `"label" in o2` stands in a loop behind a read of o2: the tests of the `in` are made on the value that the test of the read has let through, and keep what the compiler knew of their own operand: that it is a C1. Found by a fuzzer: the text is as it was found, and it prints nothing: the build is what is tested.
const log= [];
function show(value: unknown= 0){
  if (typeof value !== "object" || value === null) return ;
  const parts: [] = [];
  for (const key of Reflect.ownKeys(value)) show((value as any)[key]);
  parts.join+ "}"}
class C1 {
  weight;
  name;
  constructor(a0: number[], a1: number) {
    this.weight = a0;
    this.name = a1}
}
const o2: C1 = new C1([].map(e3=> e3), "10".indexOf("Hello"));
function f6(p0: boolean, [], p2: string){
  let boolean = o2.name ;
  for (let i8 = 0; i8 < 2; i8++) {
    o2.name ;
    log.push("label" in o2 );
    log.push(show(new C1([], 0 )))}
}
"see10 " + f6(false, [], "10") + f6
