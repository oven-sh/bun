// The class above is constructed by itself, through classes written below it, and through mixins at several depths; every field is read.
const lines = [];
class Root { root = 1; sum() { return this.root; } }
class Left extends Root { left = 2; sum() { return super.sum() + this.left; } }
class Right extends Root { right = 4; sum() { return super.sum() + this.right; } }
const Plus = (Parent) => class extends Parent { plus = 8; #secret = 16; sum() { return super.sum() + this.plus + this.#secret; } static owns(value) { return #secret in value; } };
const Twice = (Parent) => class extends Plus(Plus(Parent)) { twice = 32; sum() { return super.sum() + this.twice; } };
class OverRoot extends Plus(Root) {}
class OverLeft extends Plus(Left) {}
class OverRight extends Plus(Right) { own = 64; sum() { return super.sum() + this.own; } }
class Deep extends Twice(Left) {}
class Below extends OverLeft { below = 128; sum() { return super.sum() + this.below; } }
class OverBelow extends Plus(Below) {}
const classes = [Root, Left, Right, OverRoot, OverLeft, OverRight, Deep, Below, OverBelow];
let total = 0;
for (let i = 0; i < 900; i++) total += new classes[i % classes.length]().sum();
lines.push(total);
for (const K of classes) { const made = new K(); lines.push(K.name + "=" + made.sum() + ":" + Object.keys(made).join("")); }
for (const K of [OverRoot, OverLeft, OverRight, Deep, OverBelow]) lines.push(classes.map((Other) => (K.owns(new Other()) ? 1 : 0)).join(""));
console.log(lines.join(" "));
