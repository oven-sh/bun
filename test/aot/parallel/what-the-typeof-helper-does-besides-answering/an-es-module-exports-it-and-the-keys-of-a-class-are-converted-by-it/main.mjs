import _createClass from "./helpers/createClass.mjs";
import _typeof from "./helpers/typeof.mjs";
const before = _typeof;
var Shelf = _createClass(function Shelf() {}, [{ key: "count", value: function count() { return 3; } }]);
console.log(new Shelf().count(), before === _typeof);
