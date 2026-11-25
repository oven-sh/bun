// `require(path.join(__dirname, "..", name + ".cjs"))`: nothing reads a file when an executable runs, so it holds every file that the name may find.
// RUN(UP): link
// UP: module {{*}}path="{{*}}/beside-the-tests.cjs"
// RUN(PARTS): link
// PARTS: module {{*}}path="{{*}}/parts/second.cjs"
// A test run has a loader, which reads whatever the name says: no file need be in the program. One step out of the folder of a test file with an unknown rest behind it names every file of the project.
// RUN(TESTS): link
// OPTIONS(TESTS): runs-tests
// TESTS-NOT: beside-the-tests.cjs
// TESTS-NOT: second.cjs
// TESTS: module {{*}}path="{{*}}/tests/main.cjs"
// TESTS-NOT: beside-the-tests.cjs
// TESTS-NOT: second.cjs

// FILE: tests/main.cjs
const path = require("node:path");
exports.load = name => require(path.join(__dirname, "..", name + ".cjs"));
exports.loadPart = name => require(path.join(__dirname, "../parts", name + ".cjs"));

// FILE: beside-the-tests.cjs
exports.said = "beside the tests";

// FILE: parts/first.cjs
exports.said = "first";

// FILE: parts/second.cjs
exports.said = "second";
