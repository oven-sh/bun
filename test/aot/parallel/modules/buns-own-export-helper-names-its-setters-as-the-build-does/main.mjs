// Under: --minify: the name of the function that the helper binds is shortened in the file that declares it
// STATISTIC: KnownHelperCalls >= 1
import { lay } from "./helpers.mjs";
var lowered = {};
lay(lowered, { a: () => 1 });
var called = {};
[lay][0](called, { a: () => 1 });
const nameOf = object => Object.getOwnPropertyDescriptor(object, "a").set.name;
console.log(nameOf(lowered) === nameOf(called), lowered.a, called.a);
