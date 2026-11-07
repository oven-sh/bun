// answers: with-library
// # `const { Agent } = require("node:_http_agent")`, then `new Agent()`: as a-function-taken-by-name-out-of-a-required-file-is-expected-where-it-is-called.js, at a construction.
// # f1 = makes
// # RUN(LINK): link variables mechanisms=all
// # REQUIRES(LINK): entries-of-bun
// # LINK: taken-out-of-required-file g{{*}} f
// # RUN(WALK): walk f1 mechanisms=all
// # REQUIRES(WALK): entries-of-bun
// # WALK: TypeTest {{*}}testedType=f
// # WALK: CallDirect {{*}}function=f{{*}}isConstruction
const { Agent } = require("node:_http_agent");
function makes(sockets) { return new Agent({ maxSockets: sockets }); }
report(new Function("a", "return a + 1")(1));
report(makes(3).maxSockets);
report(makes(5) instanceof Agent);
report("end");
