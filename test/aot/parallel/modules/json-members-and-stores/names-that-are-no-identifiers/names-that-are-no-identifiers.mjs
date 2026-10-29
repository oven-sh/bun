import whole, { "a-b" as dashed, plain, "with space" as spaced } from "./dashes.json";
whole["a-b"] = "stored to";
console.log(dashed, plain, spaced);
