// The factory of a JSX element is named in a comment, through another name for `exports` or for `module`: no expression spells the read, and it takes the object.
console.log(require("./view.js").v);
console.log(require("./through-module.js").v);
console.log(require("./fragment.js").v);
console.log(require("./by-exports.js").v);
