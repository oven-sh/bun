// An import brings a name that is only a type, and the file declares a value of the same name. Code that names it means the value, so the import is dropped and the imported file does not run.
import { answer as constantAnswer } from "./uses-constant";
import { answer as functionAnswer } from "./uses-function";
import { answer as aliasAnswer } from "./uses-alias";
import { answer as renamedAnswer } from "./uses-renamed";
import { answer as defaultAnswer } from "./uses-default";
import { answer as otherAnswer } from "./uses-other-name";
import { answer as markedAnswer } from "./uses-marked";
import { answer as typeOnlyAnswer } from "./uses-type-alone";
console.log("constant", JSON.stringify(constantAnswer));
console.log("function", JSON.stringify(functionAnswer));
console.log("alias", JSON.stringify(aliasAnswer));
console.log("renamed", JSON.stringify(renamedAnswer));
console.log("default", JSON.stringify(defaultAnswer));
console.log("another name of the same statement is used", JSON.stringify(otherAnswer));
console.log("marked as types", JSON.stringify(markedAnswer));
console.log("no local value", JSON.stringify(typeOnlyAnswer));
