// Nothing but the text of a direct eval uses these three names, so a file with one keeps all it declares.
const secret = 41;
class Hidden { value() { return "hidden"; } }
const arrow = () => "arrow";
console.log(eval("secret + 1"), eval("new Hidden().value()"), eval("arrow()"));
