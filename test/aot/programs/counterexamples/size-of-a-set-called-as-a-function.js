// `set.size?.(..)` throws a TypeError: size is a number.
try { console.log(new Set(["a"]).size?.("a")); } catch (e) { console.log(e.constructor.name); }
