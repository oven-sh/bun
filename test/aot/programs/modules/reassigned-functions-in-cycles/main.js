// A function declaration at the top level of a module holds its function from before any module runs, also where its name is assigned to somewhere and so is a variable: it is called, read and assigned by modules that run before its own.
import "./called-a.js";
import "./assigned-a.js";
import "./barrel-a.js";
import "./default-a.js";
import "./renamed-a.js";
import "./namespace-a.js";
import "./kinds-a.js";
import "./inner-a.js";
import "./identity-a.js";
import "./undefined-a.js";
import "./star-a.js";
import "./three-a.js";
import "./awaits-a.js";
import "./writes-a.js";
import "./block-a.js";
import { later } from "./dynamic-a.js";
console.log("main", await later);
