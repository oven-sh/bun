class A { static a = 1; static b = 2; }
function act() { Object.defineProperty(A, "a", { get() { this.b = "text"; return "text"; } }); }
act();
console.log(typeof A.b, typeof A.a, typeof A.b);
