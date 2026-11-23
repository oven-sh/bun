type Action = { type: "deposit"; sum: number } | { type: "clear" } | { type: "label"; text: string } | { type: "ping" };
const history: (Action & { index: number })[] = [];
let total = 0;
function apply(action: Action): number {
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
console.log(total, history.length, history[1].type, history[3].index);
export {};
