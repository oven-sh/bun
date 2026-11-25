// `this[kState] = ..; this[name] = ..; this.id = id`: a field of the layout that is created on an object which already has properties that no layout lists.
// THE KEYS COME IN THE ORDER IN WHICH THEY WERE CREATED, whatever was created first, however many extra keys stand in front, and however often the same step has been taken before by an object with another number of them.
// Every kind of object is made 60 times, the kinds in turns, so that what one kind has left behind is what the next one finds. The keys come out of text that the build has not seen.
function InFront(k, n) {
    if (n > 0) this[k[0]] = "e0";
    if (n > 1) this[k[1]] = "e1";
    if (n > 2) this[k[2]] = "e2";
    if (n > 3) this[k[3]] = "e3";
    this.first = 1;
    this.second = "two";
    this.third = null;
    this.fourth = 4.5;
}
function Between(k, n) {
    this.first = 1;
    if (n > 0) this[k[0]] = "e0";
    this.second = "two";
    if (n > 1) this[k[1]] = "e1";
    if (n > 2) this[k[2]] = "e2";
    this.third = null;
    if (n > 3) this[k[3]] = "e3";
    this.fourth = 4.5;
}
function Backward(k, n) {
    if (n > 0) this[k[0]] = "e0";
    this.fourth = 4.5;
    if (n > 1) this[k[1]] = "e1";
    this.third = null;
    if (n > 2) this[k[2]] = "e2";
    this.second = "two";
    if (n > 3) this[k[3]] = "e3";
    this.first = 1;
}
class OfClass {
    constructor(k, n) {
        if (n > 0) this[k[0]] = "e0";
        if (n > 1) this[k[1]] = "e1";
        this.first = 1;
        if (n > 2) this[k[2]] = "e2";
        if (n > 3) this[k[3]] = "e3";
        this.second = "two";
        this.third = null;
        this.fourth = 4.5;
    }
}
function Later(k, n) { this.first = 1; }
const later = (k, n) => {
    const made = new Later(k, n);
    if (n > 0) made[k[0]] = "e0";
    if (n > 1) made[k[1]] = "e1";
    made.second = "two";
    if (n > 2) made[k[2]] = "e2";
    made.third = null;
    if (n > 3) made[k[3]] = "e3";
    made.fourth = 4.5;
    return made;
};
const makers = [(k, n) => new InFront(k, n), (k, n) => new Between(k, n), (k, n) => new Backward(k, n), (k, n) => new OfClass(k, n), later];
console.log(new Function("makers", `
    const a = Symbol("a"), b = Symbol("b"), c = Symbol("c"), d = Symbol("d");
    const lists = [["w", "x", "y", "z"], [a, b, c, d], [a, "x", b, "y"], ["x", a, "y", b], ["1", "x", "0", "y"], ["z", "y", "x", "w"]];
    const said = new Map();
    const lines = [];
    for (let turn = 0; turn < 60; turn++) {
        for (let maker = 0; maker < makers.length; maker++) {
            for (let list = 0; list < lists.length; list++) {
                for (let n = 0; n <= 4; n++) {
                    const made = makers[maker](lists[list], (n + turn) % 5);
                    let inLoop = "";
                    for (const key in made) inLoop += key + " ";
                    const now = Reflect.ownKeys(made).map(String).join(" ") + " | " + Object.keys(made).join(" ") + " | " + inLoop + "| " + JSON.stringify(made);
                    const name = maker + " " + list + " " + (n + turn) % 5;
                    if (!said.has(name)) { said.set(name, now); lines.push(name + ": " + now); }
                    else if (said.get(name) !== now) lines.push("AT TURN " + turn + " " + name + ": " + now);
                }
            }
        }
    }
    return lines.sort().join("\\n");
`)(makers));
