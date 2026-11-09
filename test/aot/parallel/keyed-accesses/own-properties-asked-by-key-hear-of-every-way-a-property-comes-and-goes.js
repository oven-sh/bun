// `Object.hasOwn(object, key)` and `hasOwnProperty.call(object, key)` under a key that only the run knows, asked again and again of objects that find the key above them, or nowhere.
// THE ANSWER CHANGES WITH EVERY WAY IN WHICH THE OBJECT GETS THE PROPERTY OR LOSES IT, AND WITH NOTHING ELSE: not with what happens above.
// Each kind of object and each way has its own key, so each has a place of its own, asked 60 times before anything changes.
class Request { constructor(n, socket) { this.n = n; if (socket !== undefined) this.socket = socket; } method() {} get got() { return 1; } }
class Derived extends Request { constructor(n) { super(n); this.more = n; } }
function Plain(n) { this.n = n; }
Plain.prototype.method = function () {};
const has = (object, key) => Object.hasOwn(object, key);
const called = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isIn = (object, key) => key in object;
console.log(new Function("Request", "Derived", "Plain", "has", "called", "isIn", `
    const lines = [];
    let number = 0;
    const makers = {
        instance: above => { Object.setPrototypeOf(Request.prototype, above); return new Request(1); },
        derived: above => { Object.setPrototypeOf(Request.prototype, above); return new Derived(1); },
        ofFunction: above => { Object.setPrototypeOf(Plain.prototype, above); return new Plain(1); },
        literal: above => ({ __proto__: above, n: 1 }),
        created: above => Object.create(above),
        list: above => Object.setPrototypeOf([1, 2], above),
        closure: above => Object.setPrototypeOf(function () {}, above),
        dictionary: above => { const made = { __proto__: above }; for (let i = 0; i < 80; i++) made["k" + i] = i; for (let i = 0; i < 70; i++) delete made["k" + i]; return made; },
        frozenLater: above => ({ __proto__: above, n: 1, m: 2 }),
        instanceWithManyMore: above => { Object.setPrototypeOf(Request.prototype, above); const made = new Request(1); for (let i = 0; i < 80; i++) made["k" + i] = i; for (let i = 0; i < 70; i++) delete made["k" + i]; return made; },
        instanceWithOneMore: above => { Object.setPrototypeOf(Request.prototype, above); const made = new Request(1); made.oneMore = 1; return made; },
    };
    const ways = [
        (one, key, above) => { one[key] = "stored"; },
        (one, key, above) => { Object.defineProperty(one, key, { value: "defined", configurable: true }); },
        (one, key, above) => { Object.defineProperty(one, key, { get() { return 1; }, configurable: true }); },
        (one, key, above) => { one[key] = "stored"; delete one[key]; },
        (one, key, above) => { one[key] = "stored"; delete one[key]; one[key] = "again"; },
        (one, key, above) => { above[key] = "replaced above"; },
        (one, key, above) => { delete above[key]; },
        (one, key, above) => { Object.setPrototypeOf(one, null); },
        (one, key, above) => { Object.setPrototypeOf(one, { [key]: "another above" }); },
        (one, key, above) => { Object.assign(one, { [key]: "assigned" }); },
        (one, key, above) => { Object.freeze(one); },
    ];
    for (const kind in makers) {
        for (const isSymbol of [false, true]) {
            for (const isAbove of [true, false]) {
                for (let way = 0; way < ways.length; way++) {
                    const key = isSymbol ? Symbol("s" + number++) : "key" + number++;
                    const above = isAbove ? { [key]: "above" } : { };
                    const one = makers[kind](above), other = makers[kind](above);
                    let before = "";
                    for (let turn = 0; turn < 60; turn++) before = "" + has(one, key) + called(one, key) + isIn(one, key) + has(other, key);
                    try { ways[way](one, key, above); } catch (error) { before += " refused " + error.constructor.name; }
                    let after = "";
                    for (let turn = 0; turn < 3; turn++) after += " " + has(one, key) + called(one, key) + isIn(one, key) + has(other, key) + called(other, key) + isIn(other, key);
                    lines.push(kind + " " + (isSymbol ? "symbol" : "name") + " " + (isAbove ? "above" : "nowhere") + " " + way + ": " + before + " >" + after);
                }
            }
        }
    }
    // Names that objects answer for without a property in their Structure, and objects that answer for themselves.
    const special = [[[1, 2], "length"], [[1, 2], "0"], [[1, 2], "2"], ["text", "length"], [new String("text"), "1"], [new String("text"), "9"], [function f() {}, "name"], [function f() {}, "prototype"], [() => 1, "prototype"], [class {}, "prototype"],
        [new Uint8Array(2), "1"], [new Uint8Array(2), "5"], [new Uint8Array(2), "length"], [globalThis, "Array"], [globalThis, "toString"], [globalThis, "nothingOfTheKind"],
        [new Proxy({ a: 1 }, {}), "a"], [new Proxy({ a: 1 }, {}), "toString"], [new Proxy({}, { getOwnPropertyDescriptor: () => ({ value: 1, configurable: true }) }), "anything"],
        [new Request(1, "s"), "socket"], [new Request(1), "socket"], [new Request(1), "method"], [new Request(1), "got"], [new Request(1), "n"], [new Derived(1), "more"], [Request, "name"], [Request.prototype, "method"], [Request.prototype, "got"], [(function () { return arguments; })(1, 2), "1"], [(function () { return arguments; })(1, 2), "length"], [(function () { return arguments; })(1, 2), "callee"]];
    for (const [object, key] of special) {
        let said = "";
        for (let turn = 0; turn < 40; turn++) said = "" + has(object, key) + called(object, key);
        lines.push((typeof object) + " " + key + ": " + said);
    }
    globalThis.nothingOfTheKind = 1;
    lines.push("globalThis: " + has(globalThis, "nothingOfTheKind") + called(globalThis, "nothingOfTheKind"));
    return lines.join("\\n");
`)(Request, Derived, Plain, has, called, isIn));
