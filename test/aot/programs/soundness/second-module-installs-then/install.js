import { o } from "./object.js";
o.then = function (res) { res("late"); };
