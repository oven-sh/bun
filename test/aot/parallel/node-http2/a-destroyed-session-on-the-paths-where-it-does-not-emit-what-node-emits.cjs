// The paths of the same fixture on which Bun does not emit what Node.js emits: a compiled program answers as `bun run` does there too.
process.argv[2] = "unlike-node";
require("../../../js/node/http2/node-http2-session-error-order.fixture.js");
