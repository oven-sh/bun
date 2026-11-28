const { mock, vi } = require("bun:test");
const sent = mock(to => "mock " + to);
vi.mock("./mail.ts", () => ({ send: sent }));
exports.sent = sent;
