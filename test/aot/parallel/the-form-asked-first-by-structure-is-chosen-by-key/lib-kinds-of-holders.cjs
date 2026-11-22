const { Kept, Sparse, make } = require("./lib-listed.cjs");
const wide = value => "{" + Array.from({ length: 40 }, (_, at) => JSON.stringify("k" + at) + ":" + at).join(",") + ",\"wanted\":" + JSON.stringify(value) + ",\"behind\":78}";
const made = (0, eval)(`({
    ownGetter: value => ({ x: 1, get wanted() { return value; } }),
    getterAbove: value => Object.create({ get wanted() { return value; } }),
    marked: one => Object.defineProperty(one, "beside", { get() { return 3; }, configurable: true }),
    belowNothing: value => { const one = Object.create(null); one.wanted = value; return one; },
})`);
const First = make(), Second = make();
module.exports = value => [
    [new Kept(value, 1), new Kept(value, 2)],
    [new Sparse(value, true), new Sparse(value, false), new Sparse(value, true)],
    [JSON.parse("{\"wanted\":" + JSON.stringify(value) + ",\"x\":1}")],
    [JSON.parse(wide(value))],
    [JSON.parse("{\"x\":1}")],
    [Object.create(JSON.parse("{\"wanted\":" + JSON.stringify(value) + "}"))],
    [Object.create(JSON.parse(wide(value)))],
    [made.ownGetter(value)],
    [made.getterAbove(value)],
    [made.belowNothing(value)],
    [made.marked(new Kept(value, 3)), made.marked(new Sparse(value, false))],
    [new First(value), new Second(value)],
];
