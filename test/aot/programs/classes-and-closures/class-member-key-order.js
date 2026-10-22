// The own keys of a prototype object and of a class object come in definition order, whatever the names are, and of two definitions under one name the last one counts.
const lines = [];
const middle = String(globalThis.process ? "computed" : "other");

function describe(label, holder) {
    const keys = Reflect.ownKeys(holder).map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(holder, key);
        const form = "value" in descriptor ? typeof descriptor.value : (descriptor.get ? "get" : "") + (descriptor.set ? "set" : "");
        return String(key) + ":" + form;
    });
    lines.push(label + " " + keys.join(" "));
}

class Descending {
    zebra() { return "zebra"; }
    yak() { return "yak"; }
    static walrus() { return "walrus"; }
    get viper() { return "viper"; }
    set viper(value) {}
    static urchin() { return "urchin"; }
    ant() { return "ant"; }
    static bee() { return "bee"; }
}
describe("Descending.prototype", Descending.prototype);
describe("Descending", Descending);

class ComputedInTheMiddle {
    zebra() { return "zebra"; }
    [middle]() { return "middle"; }
    ant() { return "ant"; }
    static zebra() { return "static zebra"; }
    static [middle + "Static"]() { return "static middle"; }
    static ant() { return "static ant"; }
}
describe("ComputedInTheMiddle.prototype", ComputedInTheMiddle.prototype);
describe("ComputedInTheMiddle", ComputedInTheMiddle);
lines.push(new ComputedInTheMiddle().computed(), ComputedInTheMiddle.computedStatic());

class SymbolsAndIndexes {
    zebra() { return "zebra"; }
    [Symbol.iterator]() { return [1, 2][Symbol.iterator](); }
    2() { return "two"; }
    ant() { return "ant"; }
    1() { return "one"; }
}
describe("SymbolsAndIndexes.prototype", SymbolsAndIndexes.prototype);
lines.push([...new SymbolsAndIndexes()].join());

class MethodThenGetter {
    first() { return "first"; }
    member() { return "method"; }
    last() { return "last"; }
    get member() { return "getter"; }
}
class GetterThenMethod {
    first() { return "first"; }
    get member() { return "getter"; }
    last() { return "last"; }
    member() { return "method"; }
}
class MethodTwice {
    member() { return "earlier"; }
    other() { return "other"; }
    member() { return "later"; }
}
class SetterBetweenGetters {
    get member() { return "earlier"; }
    set member(value) { lines.push("set " + value); }
    get member() { return "later"; }
}
describe("MethodThenGetter.prototype", MethodThenGetter.prototype);
describe("GetterThenMethod.prototype", GetterThenMethod.prototype);
describe("MethodTwice.prototype", MethodTwice.prototype);
describe("SetterBetweenGetters.prototype", SetterBetweenGetters.prototype);
lines.push(new MethodThenGetter().member, new GetterThenMethod().member(), new MethodTwice().member(), new SetterBetweenGetters().member);
new SetterBetweenGetters().member = "stored";

class ComputedHidesNamed {
    computed() { return "named"; }
    [middle]() { return "by computed key"; }
    tail() { return "tail"; }
}
describe("ComputedHidesNamed.prototype", ComputedHidesNamed.prototype);
lines.push(new ComputedHidesNamed().computed());

class Patched {
    zebra() { return "zebra"; }
    ant() { return "ant"; }
}
function callBoth(object) {
    return object.zebra() + " " + object.ant() + " " + (typeof object.extra === "function" ? object.extra() : "no extra");
}
lines.push(callBoth(new Patched()));
Patched.prototype.extra = function () { return "extra"; };
Patched.prototype.zebra = function () { return "patched zebra"; };
lines.push(callBoth(new Patched()));
describe("Patched.prototype", Patched.prototype);

function Legacy() {}
lines.push(typeof new Legacy().zebra);
Legacy.prototype.zebra = function () { return "legacy zebra"; };
Legacy.prototype.ant = function () { return "legacy ant"; };
lines.push(new Legacy().zebra(), new Legacy().ant());
describe("Legacy.prototype", Legacy.prototype);

class StaticFunctionProperties {
    static zebra() { return "zebra"; }
    static name() { return "name"; }
    static ant() { return "ant"; }
    static length() { return "length"; }
}
describe("StaticFunctionProperties", StaticFunctionProperties);

function defineInLoop(suffix) {
    return class {
        zebra() { return "zebra" + suffix; }
        ["m" + suffix]() { return "m" + suffix; }
        ant() { return "ant" + suffix; }
    };
}
for (const suffix of ["1", "2"]) {
    const defined = defineInLoop(suffix);
    describe("defined " + suffix, defined.prototype);
    lines.push(new defined().zebra() + new defined()["m" + suffix]() + new defined().ant());
}

console.log(lines.join("\n"));
