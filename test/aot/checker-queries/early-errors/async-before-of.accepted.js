// Not the tokens async of after for (: an escape in the name, parentheses, a member access, in, for await, an arrow function.
var async; for (\u0061sync of []) {}
async function f() { var async; for (\u0061sync of []) {} }
async function f() { var async; for ((async) of []) {} }
async function f() { var async = {}; for (async.a of []) {} }
async function f() { var async; for (async in {}) {} }
async function f() { var async; for await (async of []) {} }
async function f() { for (async of => {}; false;) {} }
