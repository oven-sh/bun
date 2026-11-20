// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 23
// CHECK-LABEL: function {{*}}name="show"
// CHECK-LABEL: function {{*}}name="isPlainLeaf"

// FILE: main.mjs
// import() of modules whose graphs have cycles, share modules with each other, and end in CommonJS modules, which run when their importers are linked. One of the roots is requested by nothing,
// one lies on a cycle. Whichever graph is linked first and whatever is linked by then: every CommonJS module runs once, before the ES modules that import it, and the ES modules run in the order
// of their requests. (In which order several CommonJS modules of one link run is the loader's business: they are shown sorted.)
globalThis.ran = [];
const isPlainLeaf = (name) => /^leaf-[a-z]+$/.test(name);
function show() {
    console.log(ran.filter(isPlainLeaf).sort().join(" "), "|", ran.filter((name) => !isPlainLeaf(name)).join(" "));
    ran.length = 0;
}
const first = await import("./first.mjs");
show();
console.log(first.describe());
const second = await import("./second.mjs");
show();
console.log(second.describe());
const again = await import("./first.mjs");
console.log(again === first, ran.length);
const third = await import("./third.mjs");
show();
console.log(third.describe());
const onCycle = await import("./ring-a.mjs");
show();
console.log(onCycle.describe());
const otherOnCycle = await import("./ring-b.mjs");
show();
console.log(otherOnCycle.name, otherOnCycle.ten);

// FILE: barrel.mjs
export * from "./leaf-five.cjs";
export * from "./shared.mjs";
ran.push("barrel");

// FILE: cycle-a.mjs
import { b } from "./cycle-b.mjs";
import { two } from "./leaf-two.cjs";
ran.push("cycle-a");
export const a = () => "a+" + b() + "+" + two;
export const name = "a";

// FILE: cycle-b.mjs
import { name } from "./cycle-a.mjs";
import { three } from "./leaf-three.cjs";
ran.push("cycle-b");
export const b = () => "b(" + name + ")+" + three;

// FILE: first.mjs
import { a } from "./cycle-a.mjs";
import { one } from "./leaf-one.cjs";
import { shared } from "./shared.mjs";
import * as barrel from "./barrel.mjs";
ran.push("first");
export const describe = () => [a(), one, shared, Object.keys(barrel).join()].join(" | ");

// FILE: inner.mjs
import { seven } from "./leaf-seven.cjs";
ran.push("inner");
export const inner = "inner+" + seven;

// FILE: late.mjs
import { nine } from "./leaf-nine.cjs";
import { shared } from "./shared.mjs";
ran.push("late");
export const late = "late+" + nine + "+" + shared.length;

// FILE: leaf-eight.cjs
ran.push("leaf-eight begins");
const inner = require("./inner.mjs");
ran.push("leaf-eight ends");
exports.eight = "eight+" + inner.inner;

// FILE: leaf-eleven.cjs
ran.push("leaf-eleven"); exports.eleven = "eleven";

// FILE: leaf-five.cjs
ran.push("leaf-five"); exports.five = "five";

// FILE: leaf-four.cjs
ran.push("leaf-four"); exports.four = "four";

// FILE: leaf-nine.cjs
ran.push("leaf-nine"); exports.nine = "nine";

// FILE: leaf-one.cjs
ran.push("leaf-one"); exports.one = "one";

// FILE: leaf-seven.cjs
ran.push("leaf-seven begins");
const late = require("./late.mjs");
ran.push("leaf-seven ends");
exports.seven = "seven+" + late.late;

// FILE: leaf-six.cjs
ran.push("leaf-six"); exports.six = "six";

// FILE: leaf-ten.cjs
ran.push("leaf-ten"); exports.ten = "ten";

// FILE: leaf-three.cjs
ran.push("leaf-three"); exports.three = "three";

// FILE: leaf-two.cjs
ran.push("leaf-two"); exports.two = "two";

// FILE: ring-a.mjs
import { name, ten } from "./ring-b.mjs";
import { shared } from "./shared.mjs";
import { eleven } from "./leaf-eleven.cjs";
ran.push("ring-a");
export const own = "ring-a";
export const describe = () => [name, ten, shared, eleven].join(" | ");

// FILE: ring-b.mjs
import { own } from "./ring-a.mjs";
export { ten } from "./leaf-ten.cjs";
ran.push("ring-b");
export const name = "ring-b";
export const other = () => own;

// FILE: second.mjs
import { shared } from "./shared.mjs";
import { six } from "./leaf-six.cjs";
import { b } from "./cycle-b.mjs";
import { inner } from "./inner.mjs";
ran.push("second");
export const describe = () => [shared, six, b(), inner].join(" | ");

// FILE: shared.mjs
import { four } from "./leaf-four.cjs";
ran.push("shared");
export const shared = "shared+" + four;

// FILE: third.mjs
import { eight } from "./leaf-eight.cjs";
ran.push("third");
export const describe = () => eight;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
