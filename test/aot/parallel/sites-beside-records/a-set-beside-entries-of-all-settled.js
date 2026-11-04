// A set and the records that Promise.allSettled() hands out meet at one parameter.
// Under: --aot-testing=CheckProofsAtRunTime: the class that LinkedFunction::result, LinkedCell::proven and LinkedParameter::proven name of a site whose family holds a record that a row makes
function bag(n) { return new Set([n, n + 1]); }
function look(x) { return x instanceof Set ? x.size : x.status; }
const alone = bag(1);
Promise.allSettled([Promise.resolve(1), Promise.reject(new Error("no"))]).then(entries => {
    console.log(look(bag(3)), look(entries[0]), look(entries[1]), entries[0].value, entries[1].reason.message, alone.has(2), alone.size, [...alone].join());
});
