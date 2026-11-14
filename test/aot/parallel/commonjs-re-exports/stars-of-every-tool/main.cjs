// STATISTIC: SlotsOfObjectsCarriedAroundLoops >= 10
// What the stars of swc, Rollup, Babel and esbuild re-export is known by its name, as what TypeScript's re-exports is.
const swc = require("./swc.cjs");
const rollup = require("./rollup.cjs");
const babel = require("./babel.cjs");
const esbuild = require("./esbuild.cjs");
function sumOfSwc(count) {
    let sum = new swc.Swc(0, 0);
    for (let i = 0; i < count; i++)
        sum = sum.add(new swc.Swc(i, 1));
    return sum.x + sum.y;
}
function sumOfOwn(count) {
    let sum = new swc.Own(0, 0);
    for (let i = 0; i < count; i++)
        sum = sum.add(new swc.Own(i, 1));
    return sum.x + sum.y;
}
function sumOfRollup(count) {
    let sum = new rollup.Rollup(0, 0);
    for (let i = 0; i < count; i++)
        sum = sum.add(new rollup.Rollup(i, 1));
    return sum.x + sum.y;
}
function sumOfBabel(count) {
    let sum = new babel.Babel(0, 0);
    for (let i = 0; i < count; i++)
        sum = sum.add(new babel.Babel(i, 1));
    return sum.x + sum.y;
}
function sumOfEsbuild(count) {
    let sum = new esbuild.Esbuild(0, 0);
    for (let i = 0; i < count; i++)
        sum = sum.add(new esbuild.Esbuild(i, 1));
    return sum.x + sum.y;
}
console.log(sumOfSwc(10), sumOfOwn(10), sumOfRollup(10), sumOfBabel(10), sumOfEsbuild(10));
console.log(swc.own, rollup.version, babel.own(), esbuild.own);
console.log(swc.default, rollup.default, babel.default, esbuild.default, typeof swc.nothing);
