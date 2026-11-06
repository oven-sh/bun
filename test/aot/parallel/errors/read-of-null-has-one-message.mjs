const evaluated = Function("o", "return o.a");
function reads() {
  const seen = {};
  for (let i = 0; i < 200000; i++) {
    let said;
    try {
      said = String(evaluated(i % 100 === 99 ? null : { a: 1 }));
    } catch (e) {
      said = e.message;
    }
    seen[said] = (seen[said] || 0) + 1;
  }
  return Object.keys(seen).length;
}
function own() {
  const seen = {};
  for (let i = 0; i < 200000; i++) {
    let said;
    try {
      said = String((i % 100 === 99 ? null : { a: 1 }).a);
    } catch (e) {
      said = e.message;
    }
    seen[said] = (seen[said] || 0) + 1;
  }
  return JSON.stringify(seen);
}
console.log(reads(), own());

/* Output:
2 {"1":198000,"null is not an object (evaluating 'null.a')":2000}
*/
