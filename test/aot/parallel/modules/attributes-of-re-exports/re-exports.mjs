export { default as json } from "./data.json" with { type: "text" };
export * as namespace from "./data.json" with { type: "text" };
export { default as text } from "./data.txt" with { type: "json" };
