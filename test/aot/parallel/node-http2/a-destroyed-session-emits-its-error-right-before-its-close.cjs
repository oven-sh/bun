// A session of node:http2 that is destroyed with an error emits 'error' right before 'close': every path of the fixture on which Bun emits what Node.js emits.
require("../../../js/node/http2/node-http2-session-error-order.fixture.js");
