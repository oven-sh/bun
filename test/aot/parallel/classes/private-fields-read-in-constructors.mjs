// STATISTIC: PrivateFieldsDefinedInStretches >= 1
// A constructor reads private fields that the class has just defined: they are filled where it reads them.
class Spinner {
    #lines = 0;
    #frame = -1;
    #last = 0;
    #text;
    #options;
    #hooked = new Set();
    #isWriting = false;
    #color;
    constructor(options) {
        if (typeof options === "string")
            options = { text: options };
        this.#options = { color: "cyan", interval: 80, ...options };
        this.color = this.#options.color;
        this.#text = this.#options.text ?? "none";
        if (typeof this.#options.enabled !== "boolean")
            this.#options.enabled = this.#lines === 0;
        this.name = this.#text + this.#frame + this.#isWriting + this.#hooked.size;
    }
    set color(value) {
        if (value === "bad")
            throw new TypeError("color " + value);
        this.#color = value;
        this.#lines++;
    }
    get color() { return this.#color; }
    step() {
        this.#frame = ++this.#frame % 3;
        this.#last += this.#options.interval;
        return this.#frame + ":" + this.#last + ":" + this.#color + ":" + this.#lines + ":" + this.name;
    }
    static has(value) { return #options in value && #frame in value; }
    static read(value) { return value.#frame; }
}
class Below extends Spinner {
    #own = this.name.length;
    constructor(options) {
        super(options);
        this.sum = this.#own + 1;
    }
    get own() { return this.#own; }
}
class Returned {
    constructor(object) { return object; }
}
class Stamped extends Returned {
    #first = 1;
    #second = this.#first + 1;
    constructor(object) {
        super(object);
        this.#second += this.#first;
    }
    static sum(value) { return value.#first * 10 + value.#second; }
}
function make(options, Type) {
    try {
        const made = new Type(options);
        return made.step() + " " + made.step() + " " + Object.keys(made) + " " + (made.own ?? "");
    } catch (error) {
        return error.constructor.name + ": " + error.message;
    }
}
for (const options of ["a", undefined, null, { text: "b", color: "red", interval: 7 }, { color: "bad" }, { enabled: false, text: 4 }, 12, new Proxy({ text: "p" }, {})])
    console.log(make(options, Spinner), "|", make(options, Below));
for (let i = 0; i < 4; i++)
    console.log(make({ text: "t" + i, interval: i }, i & 1 ? Below : Spinner));
const plain = {};
const stamped = new Stamped(plain);
console.log(stamped === plain, Stamped.sum(plain), Spinner.has(stamped), Spinner.has(new Below("x")));
for (const value of [plain, 5, new Proxy(new Spinner("y"), {})]) {
    try {
        console.log(Spinner.read(value));
    } catch (error) {
        console.log(error.constructor.name);
    }
}
try {
    new Stamped(plain);
} catch (error) {
    console.log("twice", error.constructor.name);
}
const bound = Spinner.bind(null, { text: "bound" });
console.log(make("ignored", bound), Reflect.construct(Spinner, ["r"], Below).step());
