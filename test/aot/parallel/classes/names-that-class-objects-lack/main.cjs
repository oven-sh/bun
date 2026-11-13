// `module && module.__esModule ? module : { default: module }`: a class object that nobody marks lacks the name, so the wrapper is made.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
const point_1 = __importDefault(require("./point.cjs"));
const marked_1 = __importDefault(require("./marked.cjs"));
const late_1 = require("./late.cjs");
const below_1 = __importDefault(require("./below.cjs"));
const out = [];
out.push(marked_1.default.name, typeof marked_1.default.default, new marked_1.default(1).x);
out.push(typeof below_1.default.from, new below_1.default(4, 5).x, below_1.default.made, below_1.default.__esModule);

// The names come later, through a class above, and from a key that nobody knows.
out.push(typeof late_1.helper, late_1.helper && late_1.helper());
late_1.helper = () => "late";
out.push(late_1.helper(), late_1.default);
late_1[process.argv.length > 60 ? "other" : "default"] = "keyed";
out.push(late_1.default);
class Above {}
class Below extends Above {}
out.push(Below.shared, "shared" in Below);
Above.shared = 6;
out.push(Below.shared);
Object.defineProperty(Above, "got", { get() { return this.name; } });
out.push(Below.got, Below.missing, Below.toString === Function.prototype.toString, typeof Below.call, Below.length, Below.hasOwnProperty("shared"));
class Other {}
Object.setPrototypeOf(Other, { inherited: 7 });
out.push(Other.inherited, Other.missing);
class Elements extends Array {}
out.push(typeof Elements.from, Elements.missing);

function run(turns) {
    let sum = new point_1.default(0, 0);
    const step = new point_1.default(1, 2);
    for (let turn = 0; turn < turns; turn++)
        sum = sum.add(step);
    return sum.x + sum.y;
}
out.push(run(1000));
console.log(out.join("\n"));
