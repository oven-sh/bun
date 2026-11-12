import { compare, semver, revision } from "./outer.mjs";
const parsed = JSON.parse("{}");
console.log(semver.order("1.0.0", "2.0.0"), revision === Bun.revision, compare([1], [1]), parsed.has);
