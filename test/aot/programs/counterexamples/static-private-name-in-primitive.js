// `#s in 1` throws a TypeError.
class P { static #s; static { try { console.log(#s in 1); } catch (e) { console.log(e.name); } } }
