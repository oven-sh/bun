import { test, mock } from "bun:test";
mock.module("kit/jsx-runtime", () => ({ jsx: tag => "mocked " + tag, jsxs: tag => "mocked " + tag, jsxDEV: tag => "mocked " + tag, Fragment: "fragment" }));
mock.module("kit/jsx-dev-runtime", () => ({ jsx: tag => "mocked " + tag, jsxs: tag => "mocked " + tag, jsxDEV: tag => "mocked " + tag, Fragment: "fragment" }));
test("a", async () => { const { view } = await import("./view.jsx"); console.log("a", String(view())); });
