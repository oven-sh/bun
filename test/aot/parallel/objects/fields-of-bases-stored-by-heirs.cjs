// Constructors of heirs that store fields which the constructor of the base has stored.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
class Base { constructor() { this.rope = {}; this.barrel = null; this.tint = "base"; } get isBase() { return this.tint === "base"; } }
class Boat extends Base { constructor() { super(); this.tint = "boat"; this.oar = "a"; this.load = "v"; this.quay = null; } }
class Deep extends Boat { constructor(n) { super(); this.tint = "deep"; this.load = n; this.own = n + 1; } }
class Some { constructor(more) { this.a = 1; if (more) this.b = 2; this.c = 3; } }
class OfSome extends Some { constructor(more) { super(more); this.b = 4; this.a = 5; this.d = 6; } }
class First extends Base { constructor() { super(); this.before = 1; this.tint = "first"; } }
class Frozen { constructor(how) { this.x = 1; if (how === 1) Object.freeze(this); if (how === 2) Object.preventExtensions(this); if (how === 3) delete this.x; if (how === 4) Object.defineProperty(this, "x", { value: 2, writable: false, configurable: true }); } }
class OfFrozen extends Frozen { constructor(how) { super(how); this.x = 7; this.y = 8; } }
class Answers { constructor(object) { this.k = 1; return object; } }
class OfAnswers extends Answers { constructor(object) { super(object); this.k = 2; this.l = 3; } }
class Declared extends Base { tint = "declared"; extra = 1; constructor() { super(); this.barrel = "here"; this.late = 2; } }
const classes = [Base, Boat, Deep, First, Declared], keys = ["rope,barrel,tint", "rope,barrel,tint,oar,load,quay", "rope,barrel,tint,oar,load,quay,own", "rope,barrel,tint,before", "rope,barrel,tint,extra,late"];
const types = ["base", "boat", "deep", "first", "declared"];
for (let round = 0; round < 500; ++round) {
    const place = round % classes.length, made = new classes[place](round), again = new made.constructor(round);
    for (const object of [made, again, Reflect.construct(classes[place], [round])]) {
        check("keys", Object.keys(object).join(), keys[place]);
        check("tint", object.tint, types[place]);
        check("class", object.constructor, classes[place]);
        check("is base", object.isBase, place === 0);
    }
    const some = new OfSome(round & 1);
    check("some", Object.entries(some).join(), round & 1 ? "a,5,b,4,c,3,d,6" : "a,5,c,3,b,4,d,6");
    const heir = class extends Boat { constructor() { super(); this.tint = round; this.z = round; } };
    check("heir of a moment", Object.values(new heir()).filter(value => value === round).length, round ? 2 : 2);
    check("other target", Object.keys(Reflect.construct(Boat, [], Array)).join(), keys[1]);
    check("other prototype", Object.getPrototypeOf(Reflect.construct(Boat, [], Deep)), Deep.prototype);
    for (let how = 0; how < 5; ++how) {
        let shown;
        try { shown = Object.entries(new OfFrozen(how)).join(); } catch (error) { shown = error.constructor.name; }
        check("frozen " + how, shown, ["x,7,y,8", "TypeError", "TypeError", "x,7,y,8", "TypeError"][how]);
    }
    const object = round & 1 ? { l: 0 } : undefined, answered = new OfAnswers(object);
    check("answered", Object.entries(answered).join(), round & 1 ? "l,3,k,2" : "k,2,l,3");
    check("other answer", Object.keys(new OfAnswers([round])).join(), "0,k,l");
}
Object.defineProperty(Base.prototype, "quay", { set(value) { this.seen = "set"; }, get() { return "got"; }, configurable: true });
check("behind a setter", Object.keys(new Boat()).join() + new Boat().quay, "rope,barrel,tint,oar,load,seengot");
delete Base.prototype.quay;
Object.defineProperty(Base.prototype, "barrel", { value: 1, writable: false, configurable: true });
let refused;
try { new Boat(); } catch (error) { refused = error.constructor.name; }
check("read only above", refused, "TypeError");
delete Base.prototype.barrel;
check("as before", Object.keys(new Deep(1)).join(), keys[2]);
console.log("ended", failures);
