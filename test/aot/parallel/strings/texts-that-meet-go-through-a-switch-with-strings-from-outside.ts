// The cases of a switch have numbers. What is switched on comes out of JSON, out of a slice, out of a join of written texts, and is no string at all.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a case of a switch proves
function turn(k: unknown) {
  switch (k) {
    case "left": return 1;
    case "right": return 2;
    case "": return 3;
    case "Ā": return 4;
    default: return 0;
  }
}
function side(n: number) { return n > 0 ? "left" : "right"; }
const outside = JSON.parse('["left","right","","\\u0100","Left","left ",1,null,["left"],{"toString":"left"}]') as unknown[];
const lines: string[] = [];
for (const value of outside) lines.push(String(turn(value)));
lines.push(String(turn("xleftx".slice(1, 5))), String(turn("le".concat("ft"))), String(turn(side(1))), String(turn(side(0))), String(turn(new String("left"))), String(turn(undefined)));
console.log(lines.join());
