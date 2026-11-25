import { basename, extname } from "node:path";
console.log("SAID user runs");
export const user = () => [basename("/a/user.ts"), attempt(() => extname("/a/user.ts"))].join();
const attempt = read => { try { return read(); } catch (error) { return error.name; } };
