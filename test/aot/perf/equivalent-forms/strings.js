// A loop assigns a new string to a variable in every iteration, and only the last one is read. Inside a try, and in a loop that may run no iteration,
// the variable is carried around the loop, but the string does not grow. ../equivalent-forms.test.ts holds the pairs together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
const loops = {};
const text = ("abc".repeat(300) + "x").slice(1);

loops["a string made from scratch in each iteration"] = function (n) {
  let out = "";
  let c = n;
  do {
    out = text.slice(1) + "q";
  } while (--c > 0);
  return out.length;
};
loops["a string made from scratch in each iteration inside a try"] = function (n) {
  let out = "";
  try {
    let c = n;
    do {
      out = text.slice(1) + "q";
    } while (--c > 0);
  } catch {}
  return out.length;
};
loops["a string made from scratch in each iteration of a while loop"] = function (n) {
  let out = "";
  let c = n;
  while (c-- > 0) out = text.slice(1) + "q";
  return out.length;
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
