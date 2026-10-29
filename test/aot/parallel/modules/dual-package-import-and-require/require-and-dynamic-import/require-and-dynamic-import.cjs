const r = require("two-copies");
import("two-copies").then(m =>
  console.log(m.inc(), m.inc(), r.inc(), JSON.stringify(m.state), JSON.stringify(r.state), new r.K() instanceof m.K),
);
