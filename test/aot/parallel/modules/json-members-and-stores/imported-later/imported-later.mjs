import whole from "./data.json";
import * as ns from "./data.json";
whole.a = 99;
const late = await import("./data.json");
console.log(late.a, late.default.a, late === ns);
