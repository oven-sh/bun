const arrow = (...xs) => xs.length * 2;
const holder = { base: 5, method(...xs) { return this.base + xs.length; }, get lister() { return (...xs) => xs.concat(this.base); } };
class Box { static make(...xs) { return new Box(...xs); } constructor(...xs) { this.held = xs; } size(...more) { return this.held.length + more.length; } }
let text = "";
for (let i = 0; i < 3; i++) text += [arrow(i), arrow(), holder.method(i, i), holder.lister(i).join("/"), Box.make(i, 1).size(2, 3, 4), new Box().size()].join() + ";";
console.log(text);
