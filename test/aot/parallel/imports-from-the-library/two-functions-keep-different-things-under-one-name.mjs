function First() {}
function Second() {}
First.make = () => "first";
Second.make = () => "second";
First.Kind = class A { kind() { return "a"; } };
Second.Kind = class B { kind() { return "b"; } };
Object.assign(First, { tag: () => 1 });
Object.assign(Second, { tag: () => 2 });
let text = "";
for (let i = 0; i < 4; i++) { const F = i & 1 ? First : Second; text += F.make() + new F.Kind().kind() + F.tag() + First.make() + new Second.Kind().kind() + ";"; }
console.log(text);
