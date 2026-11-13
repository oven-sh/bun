// The same where every group takes part in every match, so that each place is a piece without a test. What is printed is what plain Bun prints.
// STATISTIC: RegExpMatchAllocationsElided >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
function parts(text: string): string {
  const m = /(?:_{2147483648}|)(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)(m)(n)(o)(p)(q)(r)(s)(t)(u)(v)(w)(x)(y)(z)(A)(B)(C)(D)(E)(F)(G)(H)(I)(J)(K)(L)(M)(N)/.exec(text);
  if (!m) return "-";
  return m[15] + "," + m[16] + "," + m[26] + "," + m[39] + "," + m[40];
}
for (let i = 0; i < 3; i++) console.log(parts(unseen("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN")));
