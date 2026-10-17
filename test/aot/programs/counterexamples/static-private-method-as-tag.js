// A static private method is called as the tag of a template.
console.log(class C { static #m() { return 1; } static x = C.#m``; }.x);
