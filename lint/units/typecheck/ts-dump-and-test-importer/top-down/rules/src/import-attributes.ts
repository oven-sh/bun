import a from "./a" with { type: "json" };
export * from "./b" with { type: "json" };
type T = import("./c", { with: { "resolution-mode": "import" } }).X;
