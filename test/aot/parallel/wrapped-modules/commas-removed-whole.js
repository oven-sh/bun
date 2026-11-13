// A list of expressions that is dropped as a whole says nothing of the format.
var a = () => console.log(eval("typeof exports"), eval("typeof module")), q = 1;
typeof module, 1;
a(), q;
