function Top() { this.t = 1; }
function Mid() { this.m = 1; }
function Low() { this.l = 1; }
Object.setPrototypeOf(Mid.prototype, Top.prototype);
Object.setPrototypeOf(Low.prototype, Mid.prototype);
const test = Symbol.hasInstance;
class Other { static [test](value) { return false; } }
for (const each of [Top, Mid, Low]) each.tag = each.name;
Object.defineProperty(Mid, Symbol.hasInstance, { value: function (value) { return value === 1; } });
function isTop(value) { return value instanceof Top; }
function isMid(value) { return value instanceof Mid; }
function isLow(value) { return value instanceof Low; }
const values = [new Top(), new Mid(), new Low(), 1, null];
console.log(values.map(isTop).join(" "), "|", values.map(isMid).join(" "), "|", values.map(isLow).join(" "), "|", new Top() instanceof Other);
