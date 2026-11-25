// answers: with-library
// # `const { _checkInvalidHeaderChar: checkInvalidHeaderChar } = require("node:_http_common")`: the program makes a function out of a text, so unseen code may ask the loader for that file and store into the record that it hands back: Link proves nothing of the constant.
// # The text of the file that the require names lays a function declaration under that name: that function is expected at the call: a test of the callee, the direct call.
// # f1 = asks
// # RUN(LINK): link variables mechanisms=all
// # LINK: taken-out-of-required-file g{{*}} f
// # RUN(WALK): walk f1 mechanisms=all
// # WALK: TypeTest {{*}}testedType=f
// # WALK: CallDirect {{*}}function=f
const { _checkInvalidHeaderChar: checkInvalidHeaderChar } = require("node:_http_common");
function asks(text) { const refused = checkInvalidHeaderChar(text); return refused ? "refused" : "taken"; }
report(new Function("a", "return a + 1")(1));
report(asks("plain"));
report(asks("line\nfeed"));
report("end");
