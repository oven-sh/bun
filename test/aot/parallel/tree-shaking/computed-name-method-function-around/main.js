// Each function is called as a member of a namespace object and finds the other export of its file in `this`, in a place that belongs to it and stands inside the text of a member.
// One file a case: one function that is seen to look at `this` keeps every export of its file.
import * as case1 from "./case-1.js";
import * as case2 from "./case-2.js";
import * as case3 from "./case-3.js";
import * as case4 from "./case-4.js";
import * as case5 from "./case-5.js";
import * as case6 from "./case-6.js";
import * as case7 from "./case-7.js";
import * as case8 from "./case-8.js";
import * as case9 from "./case-9.js";
import * as case10 from "./case-10.js";
import * as own from "./own.js";
console.log(Object.keys(case1.methodName()), Object.keys(case2.getterName()), Object.keys(case3.setterName()));
console.log(Object.getOwnPropertyNames(case4.classMethodName().prototype), Object.keys(case5.staticFieldName()), Object.keys(case6.fieldName()));
console.log(Object.getPrototypeOf(case7.heritage()).name, Object.keys(case8.inAnArrow()), Object.keys(case9.defaultValue()), Object.keys(case10.generatorName()));
console.log(own.ownThisOfAMethod().method());
