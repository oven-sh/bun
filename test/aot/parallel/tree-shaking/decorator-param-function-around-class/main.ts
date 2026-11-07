// The decorators of a parameter are evaluated where the class is made, on the `this` of the function around the class. Each function
// is called as a member of a namespace object and finds the other export of its file in that `this`.
// One file a case: one function that is seen to look at `this` keeps every export of its file.
import * as case1 from "./case-1.ts";
import * as case2 from "./case-2.ts";
import * as case3 from "./case-3.ts";
import { seen } from "./marks.ts";
import * as own from "./own.ts";
case1.parameterOfAMethod();
case2.parameterOfAConstructor();
case3.parameterOfAStaticMethodInAnArrow();
console.log(own.defaultValueBehindADecorator());
console.log(seen.join("\n"));
