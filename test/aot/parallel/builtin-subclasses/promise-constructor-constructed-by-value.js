// `Promise` reached as a value: above a class, out of a table, through Reflect.construct, as the species of a class below it. Each way makes what `new Promise` makes for the same new.target,
// refuses what it refuses with the same words, shows the same frames for what an executor throws, and does so the first time as the thousandth.
const lines = [];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name + ": " + error.message; } };
const frames = error => error.stack.split("\n").slice(1).map(line => line.trim().replace(/\(.*[\\/]/, "(").replace(/^at .*[\\/]/, "at ")).filter(line => !line.includes("native")).slice(0, 5).join(" < ");
class Below extends Promise { constructor(executor, label) { super(executor); this.label = label; } }
class Deeper extends Below { #mark() { return "marked"; } mark() { return this.#mark() + this.label; } }
class Default extends Promise { }
class Other { static kind = "other"; }
const table = { first: Promise, second: Below, third: Default };
function make(name, executor) { const C = table[name]; return new C(executor, name); }
function describe(p) { return [p instanceof Promise, p instanceof Below, Object.getPrototypeOf(p).constructor.name, Object.keys(p).join()].join(" "); }
const settled = [];
for (let round = 0; round < 1200; round++) {
    const made = [make("first", r => r(round)), make("second", r => r(round)), make("third", (_, reject) => reject(round)), new Deeper(r => r(round), "d"), Reflect.construct(Promise, [r => r(round)], Other), Reflect.construct(Promise, [r => r(round)], Deeper)];
    made[2].catch(() => { });
    if (round === 0 || round === 1199) {
        lines.push(made.map(describe).join(" | "), made[3].mark(), attempt(() => made[5].mark()).split(":")[0], attempt(() => Promise.prototype.then.call(made[4], x => settled.push("other " + x)) instanceof Promise));
        made[0].then(x => settled.push("first " + x)); made[1].then(x => settled.push("second " + x)).constructor === Below && settled.push("then of a class below makes one");
        lines.push(attempt(() => make("first")), attempt(() => make("second", 5)), attempt(() => make("third", null)), attempt(() => Reflect.construct(Promise, [], Other)), attempt(() => table.first(() => { })), attempt(() => Reflect.construct(Promise, [() => { }], () => { })));
        let seen;
        make("second", () => { seen = frames(new Error("in the executor")); });
        lines.push(seen);
        make("second", () => { throw new RangeError("thrown by the executor"); }).catch(error => settled.push(error.message + ": " + frames(error)));
    }
}
let calls = 0;
class Counts extends Promise { static get [Symbol.species]() { calls++; return Promise; } }
lines.push(new Counts(r => r(1)).then(x => x) instanceof Counts, calls);
Object.setPrototypeOf(Default, function () { return { from: "a function put above the class" }; });
lines.push(attempt(() => JSON.stringify(new Default(() => { }))));
Object.setPrototypeOf(Default, Promise);
lines.push(describe(new Default(() => { })));
setTimeout(() => console.log(lines.concat(settled).join("\n")), 5);
