vitest.mock("./config.js", () => ({ mode: "mocked" }));
export const load = () => import("./config.js");
