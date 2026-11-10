// A pattern of forty groups that gets no code in the image (one alternative is longer than any text) is matched and taken apart at places beyond the sixteenth. What is printed is what plain Bun prints.
// STATISTIC: RegExpMatchAllocationsElided >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
function parts(text: string): string {
  const m = /(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)(m)(n)(o)(p)(q)(r)(s)(t)(u)(v)(w)(x)(y)(z)(A)(B)(C)(D)(E)(F)(G)(H)(I)(J)(K)(L)(M)(N)|_{2147483648}/.exec(text);
  if (!m) return "-";
  return String(m[15]) + "," + String(m[16]) + "," + String(m[26]) + "," + String(m[39]) + "," + String(m[40]);
}
console.log(parts(unseen("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN")));
