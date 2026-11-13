// A list of expressions is left out of a function's text as a whole, or stays as it is written.
const again = text => (0, eval)("(" + text + ")");
const forms = [
  function () { (void later, typeof later, !later); let later = 1; return 1; },
  function (out) { later, out.push(2); let later = 1; return out.join(); },
  function (out) { out.push(3), (later, out.push(4)); let later = 1; return out.join(); },
  function (out) { (out.push(5), out.push(6)), out.length && out.push(7), out[0]++; return out.join(); },
  function (out) { if (out) out.push(8), later; else later, out; let later = 1; return out.join(); },
];
for (const form of forms) {
  let answer;
  try {
    answer = again(form)([]);
  } catch (error) {
    answer = error.name + " " + error.message;
  }
  console.log(answer, form([]));
}
