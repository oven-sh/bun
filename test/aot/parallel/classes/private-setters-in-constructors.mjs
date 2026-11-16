// STATISTIC: PrivateFieldsFinishingBirths >= 1
// The last private field of a class is defined: the object is whole, so a setter that the constructor calls finds it so.
class Spinner {
    #frame = -1;
    #color;
    #text = "";
    #seen = 0;
    constructor(options) {
        this.color = options.color;
        this.text = options.text;
        Spinner.last = this.#seen + this.#frame;
    }
    set color(value) {
        if (value === "bad")
            throw new TypeError("color " + value);
        this.#color = value;
        this.#seen++;
    }
    get color() { return this.#color; }
    set text(value) {
        this.#text = value ?? "none";
        this.#seen += 2;
        this.#frame = this.#text.length;
    }
    get text() { return this.#text + this.#frame; }
    static count(value) { return value.#seen; }
}
class Parent {
    #text = "p";
    #calls = 0;
    constructor(options) {
        this.text = options.text;
        this.color = this.#calls;
    }
    set text(value) {
        this.#text += value;
        this.#calls++;
    }
    get text() { return this.#text + this.#calls; }
    static count(value) { return value.#calls; }
}
class Below extends Parent {
    #own = this.text;
    #later;
    constructor(options) {
        super(options);
        this.later = options.later;
        this.name = this.#own;
    }
    set later(value) { this.#later = [value, this.#own]; }
    get later() { return this.#later.join(); }
}
class Caller {
    #a = this.ask();
    #b = 2;
    #c = Caller.sum(this);
    ask() { return Caller.sum(this); }
    static sum(value) {
        try {
            return value.#b + (value.#c ?? 1);
        } catch (error) {
            return error.constructor.name;
        }
    }
    get all() { return [this.#a, this.#b, this.#c].join(); }
}
const kept = [];
class Leaking {
    #first = kept.push(this);
    #second = Leaking.read(kept[kept.length - 1]);
    static read(value) {
        try {
            return value.#second;
        } catch (error) {
            return error.constructor.name;
        }
    }
    get both() { return this.#first + String(this.#second); }
}
function attempt(work) {
    try {
        return work();
    } catch (error) {
        return error.constructor.name + ": " + error.message;
    }
}
for (const options of [{ color: "red", text: "one" }, { color: "blue" }, { color: "bad" }, { color: 5, text: "four", later: 9 }, undefined])
    for (const Type of [Spinner, Below])
        console.log(attempt(() => { const made = new Type(options); return [made.color, made.text, Spinner.last, made.later, made.name, Object.keys(made), (Type === Spinner ? Spinner : Parent).count(made)].join("|"); }));
console.log(new Caller().all, new Caller().all, new Leaking().both, kept.length, Leaking.read(kept[0]), Leaking.read({}));
let sum = 0;
for (let i = 0; i < 40; i++) {
    const made = new (i % 3 ? Spinner : Below)({ color: i, text: "t".repeat(i % 5) });
    sum += (i % 3 ? Spinner : Parent).count(made) * i + made.text.length + Spinner.last;
}
console.log(sum);
