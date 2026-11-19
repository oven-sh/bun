function Top() { this.t = 1; }
function Mid() { this.m = 1; }
function Low() { this.l = 1; }
Object.setPrototypeOf(Mid.prototype, Top.prototype);
Object.setPrototypeOf(Low.prototype, Mid.prototype);
Object.setPrototypeOf(Mid, Top);
Object.setPrototypeOf(Low, Mid);
for (const each of [Top, Mid, Low]) each.tag = each.name;
Object.defineProperty(Mid, Symbol.hasInstance, { value: function (value) { return value === this.tag; } });
function isTop(value) { return value instanceof Top; }
function isMid(value) { return value instanceof Mid; }
function isLow(value) { return value instanceof Low; }
const values = [new Top(), new Mid(), new Low(), "Mid", "Low"];
console.log(values.map(isTop).join(" "), "|", values.map(isMid).join(" "), "|", values.map(isLow).join(" "));
