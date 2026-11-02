// No member of node:module is undefined, whether or not the program names it.
import nodeModule from "node:module";
const kindsOf = object => Object.entries(object).filter(([key]) => key.startsWith("_")).map(([key, value]) => key + " " + typeof value).join();
console.log(kindsOf(nodeModule));
console.log(kindsOf({ ...nodeModule }));
console.log(Object.values(nodeModule).filter(value => value === undefined).length);
