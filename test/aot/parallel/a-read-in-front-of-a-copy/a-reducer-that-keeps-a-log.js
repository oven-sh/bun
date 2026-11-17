const history = [];
let total = 0;
function apply(action) {
  if (action.type === "ping") return total;
  history.push({ ...action, index: history.length });
  if (action.type === "deposit") total += action.sum;
  else if (action.type === "clear") total = 0;
  return total;
}
apply({ type: "deposit", sum: 5 });
apply({ type: "clear" });
apply({ type: "deposit", sum: 7 });
apply({ type: "label", text: "rent" });
console.log(total, history.length, history[0].sum, history[3].text);
