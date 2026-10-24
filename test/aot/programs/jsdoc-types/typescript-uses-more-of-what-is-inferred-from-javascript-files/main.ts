import both = require("./both.cjs");
import settings, { arrow, fewer, Fields, fromOther, Grown, later, many, other, otherFn, space, tuple, untypedTag, variadic, withDefault } from "./esm.js";
import { two } from "./object.cjs";
import { Legacy, one, sep } from "./pattern.cjs";

console.log(fewer(), fewer(1), fewer(1, 2), variadic());
console.log(new Grown().x + 1, Grown.made + 1);
console.log(space.sub.value + 1, space.fn(1), settings.name.length, settings.size() + 1);
console.log(Fields.count + 1, new Fields().shown + 1, new Fields().both + 1, Fields.make().shown);
console.log(arrow(1), arrow(1, 1), withDefault(), withDefault(2, { b: 3 }), (await later()) + 1, [...many()].length, tuple[0] + 1, tuple[1].length, untypedTag(1));
console.log(fromOther.length, otherFn() + 1, other.fromOther, other.otherFn());
console.log(both(), two + 1, one + 1, sep.length, Legacy.create("a").greet(), Legacy.create("b").name);
