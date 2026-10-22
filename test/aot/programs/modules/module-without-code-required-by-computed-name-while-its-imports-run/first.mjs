import { namesOf } from "./load.cjs";
console.log("first starts");
console.log("first sees:", namesOf(["without", "code"].join("-")));
export const first = 1;
console.log("first ends");
