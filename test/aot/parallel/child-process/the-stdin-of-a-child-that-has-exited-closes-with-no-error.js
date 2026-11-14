// One callback after spawn(), child.stdin of a child that has exited closes with no 'error'. In the turn of spawn(), and for a live child that closed its stdin, the 'error' is EPIPE.
const fs = require("node:fs");
const { table } = require("../../../js/node/child_process/fixtures/stdin-exited-child-fixture.js");

const scratch = fs.mkdtempSync(require("node:os").tmpdir() + "/stdin-");
table("both kinds", scratch).then(rows => {
  fs.rmSync(scratch, { recursive: true });
  for (const [row, events] of Object.entries(rows)) {
    console.log(`${row}: ${events.find(event => event.startsWith("stdin error ")) ?? "no 'error'"}`);
  }
});
