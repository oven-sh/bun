// A logical assignment, a pattern with a default and a rest element, and the heads of `for..of` and `for..in` store through a defined name whose `--define` value is one name to the `let` of that name. Each `let` has one such store and no other.
// Flags: --define OR=either --define AND=both --define NULLISH=missing --define ITEM=item --define REST=rest --define MEMBER=member --define SHORT=short --define FALLBACK=fallback --define OTHERS=others --define EACH=each --define KEY=key
let either = 0;
let both = 1;
let missing = null;
OR ||= "or";
AND &&= "and";
NULLISH ??= "nullish";
console.log(either, both, missing);
let item = "unset";
let rest = "unset";
[ITEM, ...REST] = [1, 2, 3];
console.log(item, rest);
let member = "unset";
let short = "unset";
let fallback = "unset";
let others = "unset";
({
  a: MEMBER,
  SHORT,
  FALLBACK = "the default",
  ...OTHERS
} = { a: "a", SHORT: "by the defined name", short: "by the name of the let", z: 26 });
console.log(member, short, fallback, JSON.stringify(others));
let each = "unset";
let key = "unset";
for (EACH of ["first", "last"]);
for (KEY in { only: 1 });
console.log(each, key);
