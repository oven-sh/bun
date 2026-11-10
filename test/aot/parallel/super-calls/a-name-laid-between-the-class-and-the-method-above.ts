// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
// STATISTIC: SuperCallsDevirtualized >= 1
const words: Record<string, string> = JSON.parse('{"weigh":"weigh","proto":"prototype"}');
class Root { weigh(by: number): number { return by; } }
class Middle extends Root {}
class Leaf extends Middle { weigh(by: number, again?: boolean): number { return again ? this.weigh(by) : super.weigh(by) + 1000; } }
const leaves: Leaf[] = JSON.parse("[0,0,0]").map(() => new Leaf());
function sum(by: number): number { let all = 0; for (const leaf of leaves) all += leaf.weigh(by); return all; }
console.log("as written", sum(1), sum(2));
(Middle as any)[words.proto][words.weigh] = function (by: number) { return by * 10; };
console.log("a method laid between", sum(1), sum(2));
delete (Middle as any)[words.proto][words.weigh];
console.log("and taken away again", sum(1), sum(2));
(leaves[1] as any)[words.weigh] = () => -1;
console.log("one object hides the heir's own method", sum(1), sum(2));
