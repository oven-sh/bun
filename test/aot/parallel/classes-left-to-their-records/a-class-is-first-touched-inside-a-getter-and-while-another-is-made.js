class Above { who() { return "above"; } static kind() { return "A"; } }
class First extends Above { static peer() { return Second; } own() { return new Second().own() + 1; } }
class Second extends Above { static peer() { return First; } own() { return 1; } }
const holder = { get made() { return new First().own(); }, get proto() { return Object.getPrototypeOf(Second.prototype) === Above.prototype; } };
console.log(holder.made, holder.proto, First.peer() === Second, Second.peer() === First, First.peer().peer().kind());
class Third extends Above { static table = [Third.prototype, Object.getPrototypeOf(Third.prototype) === Above.prototype, Third.kind()]; own() { return 3; } }
console.log(Third.table[0] === Third.prototype, Third.table[1], Third.table[2], new Third().own());
let touched = "";
class Fourth extends Above { static { touched = Object.getOwnPropertyNames(Fourth.prototype).join() + new Fourth().who(); } own() { return 4; } }
console.log(touched);
