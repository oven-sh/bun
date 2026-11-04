// the body of a loop over a list calls what throws, and nothing in the function with the loop catches it
let seen = "";
function check(v: number, limit: number) {
  if (v === limit) throw new Error("at " + v);
}
function walk(list: number[], limit: number): string {
  for (const v of list) {
    seen += v;
    check(v, limit);
  }
  return "done";
}
function deed(limit: number) {
  seen = "";
  try {
    return walk([1, 2, 3], limit) + " " + seen;
  } catch (e) {
    return (e as Error).message + " " + seen;
  }
}
console.log(deed(9));
for (let i = 0; i < 5; i++) console.log(deed(i));
console.log(deed(9));
