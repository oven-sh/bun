// A catch parameter holds the number that was thrown, so calling it throws a TypeError.
function caught(n) { try { throw 7; } catch (f) { return () => f() + (f = () => n); } }
try { caught(2)(); } catch (e) { console.log(e.name); }
