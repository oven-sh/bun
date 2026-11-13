// What end() of a child's standard input is given is in the pipe when the call returns: the three tools of the fixture close their input, unread, in the turn that called.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const folder = fs.mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "stdin-send-in-call-"));
const fifos = [folder + "/go", folder + "/done"];
execFileSync("mkfifo", fifos);
process.on("exit", () => fs.rmSync(folder, { recursive: true, force: true }));
// The fixture takes the two paths from its arguments.
process.argv.splice(2, Infinity, ...fifos);
require("../../../js/node/child_process/fixtures/stdin-send-in-call-fixture.js");
