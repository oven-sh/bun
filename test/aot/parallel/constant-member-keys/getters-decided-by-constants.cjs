// Under: --aot-harden=proof-checks: a getter's answer is held against the getter walked again without folding, and the build stopped at the cases that the scan never enters
function show(f) {
  console.log(f());
}
var fraction = 0.5;
var word = "a" + "b";
var nothing = undefined;
class C {
  get byFraction() {
    switch (fraction) {
      case 6:
        return "six";
      case "a":
        return "letter";
      case undefined:
        return "none";
      default:
        return "other";
    }
  }
  get byWord() {
    if (word === "ab") return word + fraction;
    return nothing ?? "left";
  }
  get bySum() {
    return fraction * 2 + 1 > 3 ? "more" : -fraction < 0 ? "less" : "none";
  }
}
show(() => new C().byFraction);
show(() => new C().byWord);
show(() => new C().bySum);
const record = {
  get kind() {
    switch (typeof nothing) {
      case "number":
        return 1;
      case "undefined":
        return fraction === 0.5 ? "half" : "whole";
    }
    return 2;
  },
};
for (let i = 0; i < 3; i++) show(() => record.kind);
