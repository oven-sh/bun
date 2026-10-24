// `catch (e) { var e = 2 }` stores to the catch parameter.
try { throw 1; } catch (e) { var e = 2; console.log(e); }
