// `(T?.#m)()` calls the method.
class T { static #m() { return 1; } static { console.log((T?.#m)()); } }
