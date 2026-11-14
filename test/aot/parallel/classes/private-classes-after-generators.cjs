class Entry { constructor(value) { this.value = value; } }
function* entries(count) { for (let i = 0; i < count; i++) { const entry = new Entry(i); yield entry; } }
console.log([...entries(1)]);

class Counter { #count = 0; get count() { return this.#count; } }
console.log(new Counter().count, new Counter().count);

class Greeter {
    static #made = 0;
    static made() { return Greeter.#made; }
    #name;
    constructor(name) { this.#name = name; ++Greeter.#made; }
    #greeting() { return "hello " + this.#name; }
    greet() { return this.#greeting(); }
    static is(value) { return #name in value; }
}
console.log([...entries(2)].length);
for (const name of ["a", "b"]) {
    for (const round of [1, 2]) {
        const greeter = new Greeter(name + round);
        console.log(greeter.greet(), Greeter.made(), Greeter.is(greeter), Greeter.is({}));
    }
}
