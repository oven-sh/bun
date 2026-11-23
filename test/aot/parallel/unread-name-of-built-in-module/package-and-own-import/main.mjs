import { inspect } from "node:util";
const page = await import("./page.mjs");
console.log("end", Object.keys(page).join(), typeof inspect);
