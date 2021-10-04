import {
__HMRModule as HMR
} from "http://localhost:8080/__runtime.js";
import {
__HMRClient as Bun
} from "http://localhost:8080/__runtime.js";
Bun.activate(false);

var hmr = new HMR(2482749838, "string-escapes.js"), exports = hmr.exports;
(hmr._load = function() {
  var tab = "\t";
  var シ = "wow";
  var f = "";
  var obj = {
    "\r\n": "\r\n",
    "\n": "\n",
    "\t": "\t",
    "\u2028": "\u2028",
    "\u2029": "\u2029",
    "😊": "😊",
    "😃": "😃",
    "㋡": "㋡",
    "☺": "☺",
    シ: "シ",
    f,
    "☹": "☹",
    "☻": "☻",
    children: 123
  };
  const foo = () => {
  };
  const Bar = foo("a", {
    children: 123
  });
  const carriage = obj["\r\n"];
  const newline = obj["\n"];
  function test() {
    console.assert(carriage === "\r\n");
    console.assert(newline === "\n");
    console.assert(tab === "\t");
    return testDone(import.meta.url);
  }
  hmr.exportAll({
    obj: () => obj,
    test: () => test
  });
})();
var $$hmr_obj = hmr.exports.obj, $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_obj = exports.obj;
  $$hmr_test = exports.test;
};

export {
  $$hmr_obj as obj,
  $$hmr_test as test
};
