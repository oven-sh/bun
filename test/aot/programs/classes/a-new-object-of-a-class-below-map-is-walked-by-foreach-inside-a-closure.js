// A class without members stands below Map. A new object of it is walked by forEach inside a closure that is handed to a function with two callers.
function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name, error.message);
  }
}
class M extends Map {}
const item = { name: "item" };
attempt("map forEach", () => { let t = ""; new M([["k", item]]).forEach((v, k, m) => (t += v.name + k.length + m.size)); return t; });
attempt("other", () => 1);
