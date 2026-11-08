const history = [];
let total = 0;
function apply(action) {
  history.push({ ...action, index: history.length });
  return total;
}
apply({ type: "deposit", sum: 5 });
apply({ type: "clear" });
apply({ type: "label", text: "rent" });
console.log(total, history.length, history[0].sum, history[2].text);
