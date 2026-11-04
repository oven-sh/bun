// the growing text stands among the parts of its own growth: alone, in the middle, twice, and through a function that reads it
function doubled(n: number) { let s = "ab"; for (let i = 0; i < n; i++) s += s; return s; }
function wrapped(n: number) { let s = "a"; for (let i = 0; i < n; i++) s += "<" + s + ">"; return s; }
function twice(n: number) { let s = "a"; for (let i = 0; i < n; i++) s += s + "-" + s; return s; }
function measured(n: number) { let s = "a"; for (let i = 0; i < n; i++) s += "(" + s.length + ")"; return s; }
function tail(text: string) { return text.slice(-2); }
function throughCall(n: number) { let s = "ab"; for (let i = 0; i < n; i++) s += i + tail(s); return s; }
function templated(n: number) { let s = "a"; for (let i = 0; i < n; i++) s = `${s}[${s}]`; return s; }
console.log(doubled(0), doubled(1), doubled(3));
console.log(wrapped(0), wrapped(1), wrapped(3));
console.log(twice(0), twice(1), twice(2));
console.log(measured(0), measured(1), measured(12));
console.log(throughCall(0), throughCall(1), throughCall(5));
console.log(templated(0), templated(1), templated(3));
