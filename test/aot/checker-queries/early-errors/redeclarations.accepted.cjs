// Sloppy mode code: var and function declarations can repeat a name.
var f; function f() {}
function f() {} function f() {}
{ function f() {} function f() {} }
// Not listed: function f(a, a) {} ECMAScript allows it in sloppy mode code and bun run's parser rejects it.
