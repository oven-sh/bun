// What a list of expressions drops of itself still says that the file is CommonJS, where something of the list stays.
var a = () => console.log(eval("typeof exports"), eval("typeof module")), q = 1;
(typeof module /* ; */, q), a();
