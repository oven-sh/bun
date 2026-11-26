import typed from "./data.json" with { type: "json" };
import text from "./data.json" with { type: "text" };
import untyped from "./data.json";
export const seen = () => JSON.stringify([typed, text, untyped]);
