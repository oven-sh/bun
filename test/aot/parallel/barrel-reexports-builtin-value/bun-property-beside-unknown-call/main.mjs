import { which } from "./names.mjs";
import { which as direct } from "bun";
const parsed = JSON.parse("{}");
console.log(typeof which, which === direct, parsed.get ? parsed.get() : "-", typeof parsed.apply);
