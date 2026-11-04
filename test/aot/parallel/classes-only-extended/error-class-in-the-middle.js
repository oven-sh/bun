class First extends Error { constructor(m) { super(m); this.code = 1; } who() { return "first"; } }
class Second extends First { constructor(m) { super(m); this.more = 2; } who() { return "second"; } }
function raise(C) { try { throw new C("m"); } catch (e) { return [e.who(), e.message, e.code, e.more, e instanceof Second, e.constructor.name].join(); } }
console.log(raise(Second));
console.log(raise(Object.getPrototypeOf(Second)));
