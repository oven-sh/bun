// the body of a loop over a list throws, and a try around the loop in the same function catches it
function walk(list: number[], limit: number): string {
  let seen = "";
  try {
    for (const v of list) {
      seen += v;
      if (v === limit) throw new Error("at " + v);
    }
  } catch (e) {
    return seen + "!" + (e as Error).message;
  }
  return seen;
}
function deed(limit: number) {
  return walk([1, 2, 3], limit);
}
console.log(deed(9));
for (let i = 0; i < 5; i++) console.log(deed(i));
console.log(deed(9));
