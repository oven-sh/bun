// A method called in tail position of a copied function: through the table of methods, found by name, by guess.
const box = JSON.parse("{}");
const [key] = JSON.parse('["hidden"]');
function hide(value) {
    box[key] = value;
    return box[key];
}
class Base {
    constructor() { this.n = 1; }
    find(a) { return a + this.n; }
    put(f) { this.find = f; }
}
class Other extends Base { find(a) { return a * 2; } }
class Holder {
    constructor(inner) { this.inner = inner; }
    call(a) { return this.inner.find(a); }
}
const list = [new Base(), new Other()];
const holders = [new Holder(list[0]), new Holder(list[1])];
const hidden = hide(new Holder(list[0]));
function pick(times, which) {
    let sum = 0;
    for (let i = 0; i < times; i++)
        sum = (sum * 31 + which.call(i % 11)) | 0;
    return sum;
}
function known(times) {
    let sum = 0;
    for (let i = 0; i < times; i++)
        sum = (sum * 31 + holders[i & 1].call(i % 11)) | 0;
    return sum;
}
function union(times) {
    let sum = 0;
    const call = (o, a) => o.find(a);
    for (let i = 0; i < times; i++)
        sum = (sum * 31 + call(list[i & 1], i % 11)) | 0;
    return sum;
}
function attempt(work) {
    try {
        return work();
    } catch (error) {
        return error.name + ": " + error.message + " " + error.stack.split("\n").slice(1, 3).map(line => line.trim().split(" ")[1]).join(" < ");
    }
}
const say = word => {
    console.log(word, attempt(() => pick(13, hidden)));
    console.log(word, attempt(() => pick(13, holders[1])));
    console.log(word, attempt(() => known(13)));
    console.log(word, attempt(() => union(13)));
};
say("as made");
list[0].put(undefined);
say("stored undefined");
list[0].put(5);
say("stored a number");
delete list[0].find;
say("deleted");
Other.prototype.find = null;
say("null above");
