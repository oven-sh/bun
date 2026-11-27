// `list.push(a, ...other)`: the source has an iterator of its own, which sees the receiver as it was and may change it.
const said = [];
function gather(source, watch) { const out = ["w"]; watch.out = out; out.push("a", ...source); return out; }
const watch = {};
const own = [1, 2, 3];
own[Symbol.iterator] = function* () { said.push("sees " + JSON.stringify(watch.out)); yield 10; watch.out.push("from the iterator"); said.push("then " + JSON.stringify(watch.out)); yield 20; };
console.log(JSON.stringify(gather(own, watch)), said.join(" | "));
console.log(JSON.stringify(gather([7, 8], watch)));
