// Fifteen groups, one name given to two of them, no code in the image: 33 words of offsets. The RegExp is written for the call, the array is kept, the named group is read. What is printed is what plain Bun prints.
const unseen = (x: any): any => [x][JSON.parse("0")];
const kept: unknown[] = [];
function parts(text: string): string {
  const m = /(?<n>a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)(m)(n)|(?<n>z)|_{2147483648}/.exec(text);
  kept.push(m);
  if (!m) return "-";
  return String(m.groups!.n) + "," + String(m[14]) + "," + String(m[15]);
}
for (let i = 0; i < 20; i++) console.log(parts(unseen("abcdefghijklmn")));
console.log(kept.length);
