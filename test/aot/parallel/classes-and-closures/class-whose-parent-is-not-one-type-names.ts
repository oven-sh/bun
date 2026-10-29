// A class whose parent is not the one its type names.
const unseen = new Function("x", "return x");
class Named {
  static kind() { return "named"; }
  who() { return "named"; }
  size() { return 1; }
}
class Other {
  static kind() { return "other"; }
  who() { return "other"; }
  size() { return 2; }
  extra() { return "extra"; }
}
const Expected = unseen(Named) as typeof Named;
const Swapped = unseen(Other) as typeof Named;
class BelowExpected extends Expected {
  me() { return this.who() + this.size(); }
}
class BelowSwapped extends Swapped {
  me() { return this.who() + this.size(); }
}
class Leaf extends BelowSwapped {
  all() { return this.me() + super.who(); }
}
const Unknown: any = unseen(Other);
class BelowUnknown extends Unknown {
  me() { return this.who() + this.size() + this.extra(); }
}
function ask() {
  return [new BelowExpected().me(), new BelowSwapped().me(), new Leaf().all(), new BelowUnknown().me(), BelowExpected.kind(), BelowSwapped.kind(), Leaf.kind(), BelowUnknown.kind(),
    new BelowSwapped() instanceof Named, new BelowSwapped() instanceof Other, new Leaf() instanceof Other, new BelowExpected() instanceof Named].join(" ");
}
for (let round = 0; round < 3; round++)
  console.log(ask());
unseen(Named).prototype.who = function () { return "named2"; };
console.log(ask());
unseen(Other).prototype.who = function () { return "other2"; };
console.log(ask());
unseen(Other).kind = function () { return "other kind 2"; };
console.log(ask());
Object.setPrototypeOf(unseen(BelowExpected).prototype, Other.prototype);
console.log(ask());
