// A promise and the record of Promise.withResolvers() meet in one list.
// Under: --aot-testing=CheckProofsAtRunTime: the class that LinkedFunction::result, LinkedCell::proven and LinkedParameter::proven name of a site whose family holds a record that a row makes
function later(n) { return Promise.resolve(n); }
function open() { return Promise.withResolvers(); }
const both = [later(1), open()];
const alone = later(2);
both[1].resolve(5);
console.log(alone instanceof Promise, both[0] instanceof Promise, both[1] instanceof Promise, typeof both[1].resolve, Object.keys(both[1]).sort().join());
alone.then(v => both[1].promise.then(w => both[0].then(x => console.log(v, w, x))));
