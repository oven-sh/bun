// Fifteen groups, one name given to two of them, no code in the image: 33 words of offsets. The RegExp is held, the array is kept, the named group is read. What is printed is what plain Bun prints.
const p = /(?<n>a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)(m)(n)|(?<n>z)|_{2147483648}/;
const kept: (RegExpMatchArray | null)[] = [];
function f(s: string): string { const m = s.match(p); kept.push(m); return m ? String(m.groups!.n) + " " + m.length + " " + m[14] : "none"; }
let r = ""; for (let i = 0; i < 100; i++) r = f("abcdefghijklmn"); console.log(r, kept.length);
