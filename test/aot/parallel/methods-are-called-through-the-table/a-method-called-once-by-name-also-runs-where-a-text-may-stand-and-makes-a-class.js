class Base { split(by) { return 0; } }
class A extends Base { split(by) { return class Made { static made = []; static note(value) { Made.made.push(value); return Made.made.length; } }; } }
class B extends Base { split(by) { return class Other { static note() { return "B"; } }; } }
const nobodyKnows = globalThis.separator ?? { [Symbol.split](text) { return [text.length]; } };
function cut(text, by) { return text.split(by); }
const first = cut(new A(), nobodyKnows), other = cut(new B(), nobodyKnows), parts = cut("a,b", nobodyKnows);
const second = new A().split(",");
console.log(first.note(1), first.note(2), second.note(3), first === second, other.note(), String(parts));
