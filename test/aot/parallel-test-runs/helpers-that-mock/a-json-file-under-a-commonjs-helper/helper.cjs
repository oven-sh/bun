const { mock } = require("bun:test");
const sent = mock(to => "mock " + to);
mock.module("./settings.json", () => ({ name: "mock" }));
exports.sent = sent;
