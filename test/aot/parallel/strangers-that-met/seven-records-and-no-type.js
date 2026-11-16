const soup = { name: "soup", warmth: 3 };
const salad = { name: "salad", leaves: 5, tags: ["green"] };
const bread = { name: "bread", length: 30 };
const stew = { name: "stew", hours: 4, hidden: true };
const cake = { name: "cake", layers: 2, tags: ["sweet", "round"] };
const rice = { grains: 900, name: "rice" };
const tea = { name: "tea", cups: 1 };
const dishes = [soup, salad, bread, stew, cake, rice, tea];
function describe(dish) {
  return dish.name + (dish.tags !== undefined ? "[" + dish.tags.join() + "]" : "") + (dish.hidden ? "?" : "");
}
let text = "";
for (let turn = 0; turn < 3; turn++) for (const dish of dishes) text += describe(dish) + " ";
console.log(text);
