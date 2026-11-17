// STATISTIC: SpeculatedReceiversDispatchedByShape >= 3
// Receivers of unknown type: the file has two or three classes with the method that a loop calls.
class Disk { constructor(r) { this.r = r; } area(k) { return this.r * k; } name() { return "disk"; } }
class Slab { constructor(w, h) { this.w = w; this.h = h; } area(k) { return this.w * this.h + k; } name() { return "slab"; } }
class Wedge { constructor(h) { this.h = h; } area(k) { if (k === 5) throw new Error("wedge " + this.h); return this.h - k; } }
function Dash(long) { this.long = long; }
Dash.prototype.grow = function (by) { this.long += by; return this.long; };
function Line(far) { this.far = far; }
Line.prototype.grow = function (by) { return this.far * by; };

const box = JSON.parse("{}");
const [key, AREA, GROW, NAME] = JSON.parse('["hidden", "area", "grow", "name"]');
function hide(value) {
    box[key] = value;
    return box[key];
}
function lay(object, name, value) {
    object[name] = value;
    return hide(object);
}

function areas(list, times) {
    let sum = 0;
    for (let i = 0; i < times; i++) {
        const figure = list[i % list.length];
        try {
            sum += figure.area(i % 4);
        } catch (error) {
            sum += error.message.length;
        }
    }
    return sum;
}
function growth(list, times) {
    let sum = 0;
    for (let i = 0; i < times; i++)
        sum += list[i % list.length].grow(i & 3);
    return sum;
}
function names(figure, times) {
    let text = "";
    for (let i = 0; i < times; i++)
        text += figure.name()[i % 4];
    return text;
}
function attempt(work) {
    try {
        return work();
    } catch (error) {
        return error.constructor.name + ": " + error.message;
    }
}

const figures = hide([hide(new Disk(2)), hide(new Slab(3, 4)), hide(new Wedge(9))]);
const lines = hide([hide(new Dash(1)), hide(new Line(2))]);
const say = word => console.log(word, attempt(() => areas(figures, 24)), attempt(() => growth(lines, 12)), attempt(() => names(figures[0], 8)), attempt(() => names(figures[1], 8)));
say("as made");
say("again");
figures.push(lay({}, AREA, k => k * 100));
lines.push(lay({ long: 1 }, GROW, by => by + 1000));
say("other objects with the names");
figures.push(hide(Object.create(new Slab(5, 6))));
say("an object below an instance");
lay(figures[0], AREA, k => -k);
say("a name of its own");
lines.push(hide(new Proxy(new Dash(4), { get: (target, name, receiver) => (name === GROW ? by => by - 50 : Reflect.get(target, name, receiver)) })));
say("a proxy");
Object.setPrototypeOf(figures[1], Wedge.prototype);
say("another prototype");
lay(Slab.prototype, AREA, function (k) { return 7000 + k; });
lay(Dash.prototype, GROW, function (by) { return 9000 + by; });
say("another method");
Object.defineProperty(Wedge.prototype, AREA, { get() { return k => 300000 + k; }, configurable: true });
say("a getter in its place");
delete Disk.prototype[NAME];
say("no method");
figures.push(hide(null));
lines.push(hide(3));
say("no object");
