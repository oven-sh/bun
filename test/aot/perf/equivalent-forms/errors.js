// A function makes an error six calls deep: once it keeps the error in a variable that it reads again, once it returns the error at once.
// ../equivalent-forms.test.ts holds the pair together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
const loops = {};
let made = 0;

function keepsError(depth) {
  if (depth) {
    const below = keepsError(depth - 1);
    made++;
    return below;
  }
  const error = new Error("x");
  made++;
  return error;
}
function returnsError(depth) {
  if (depth) {
    const below = returnsError(depth - 1);
    made++;
    return below;
  }
  made++;
  return new Error("x");
}
loops["an error that is kept"] = function (n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += keepsError(5).message.length;
  return sum + made;
};
loops["an error that is returned at once"] = function (n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += returnsError(5).message.length;
  return sum + made;
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
