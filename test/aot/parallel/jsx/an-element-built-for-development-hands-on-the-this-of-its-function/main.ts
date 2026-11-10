// jsxDEV's sixth argument is the `this` of the function that holds the element, and no `this` is written there.
// A call through a namespace hands the namespace over whole, with the names that nothing else reads.
import * as parts from "./parts";
import * as shelf from "./shelf";
console.log(parts.Page());
console.log(parts.InArrow());
console.log(parts.Stored());
console.log(parts.Plain());
console.log(shelf.Fragments());
const holder = { Page: parts.Page, marked: true };
console.log(holder.Page());
