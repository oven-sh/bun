// Evaluated text calls an async function of the program, changes the promise that it gets and hands that promise back. With a `then` of its own alone an await still
// gives what the function returned: an await of a promise of the realm asks for `constructor` and not for `then`. With another `constructor` too, the `then` runs.
// The promises that the program gets from its own calls of the same functions are other objects: nothing was done to them.
async function count(n) {
  return n * 2;
}
async function label(n) {
  return { text: "n" + n };
}
const changeThen = new Function("f", "n", "const p = f(n); p.then = function (resolve) { resolve('changed ' + n); }; return p;");
const changeBoth = new Function("f", "n", "const p = f(n); p.constructor = Object; p.then = function (resolve) { resolve('changed ' + n); }; return p;");
const withThen = changeThen(count, process.argv.length);
const withBoth = changeBoth(count, process.argv.length);
console.log(await withThen, await withBoth, await changeBoth(label, process.argv.length + 1));
console.log(await count(process.argv.length), (await label(process.argv.length)).text);
const own = count(5);
console.log(own.then === Promise.prototype.then, withThen.then === Promise.prototype.then, own.constructor === Promise, withBoth.constructor === Promise, await own);
