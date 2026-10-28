// `export default v` takes the value that v has there, which is undefined when `var v = ..` stands below it.
import d from "./main.js";
export default v;
var v = () => 1;
console.log(typeof d);
