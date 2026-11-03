// Prints the names of functions and classes without names that stand behind a comma or an operator: they take no name from where they are stored. Plain Bun prints another output.
const direct = (0, () => {});
let assigned;
assigned = (0, function () {});
const { inPattern = (0, () => {}) } = {};
const [inList = (0, class {})] = [];
function takes(parameter = (0, () => {})) {
  return parameter.name;
}
const held = { member: (0, () => {}) };
class Holder {
  field = (0, () => {});
}
const told = (console.log("runs"), () => {});
const text = ("a", () => {});
console.log(
  [
    direct.name,
    assigned.name,
    inPattern.name,
    inList.name,
    takes(),
    held.member.name,
    new Holder().field.name,
    told.name,
    text.name,
  ]
    .map(name => JSON.stringify(name))
    .join(" "),
);
const nullish = null ?? (() => {});
const either = 0 || function () {};
const both = 1 && class {};
const chosen = true ? () => {} : 0;
console.log([nullish, either, both, chosen].map(each => JSON.stringify(each.name)).join(" "));
/* Output:
runs
"" "" "" "" "" "" "" "" ""
"" "" "" ""
*/
