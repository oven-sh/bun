// Prints the names of functions and classes without names that are read out of the literal they are written in: the key of an object names them, a place in a list does not. Plain Bun prints another output.
exports.stored = { held: () => {} }.held;
const direct = { held: () => {} }.held;
let assigned;
assigned = { held: function () {} }.held;
const { inPattern = { held: () => {} }.held } = {};
const [inList = { held: class {} }.held] = [];
function takes(parameter = { held: () => {} }.held) {
  return parameter.name;
}
function returns() {
  return { held: () => {} }.held;
}
const holder = { member: { held: () => {} }.held };
class Holder {
  field = { held: () => {} }.held;
}
const underAText = { held: () => {} }["held"];
const optional = { held: async () => {} }?.held;
const spell = names => names.map(name => JSON.stringify(name)).join(" ");
console.log(
  spell([
    exports.stored.name,
    direct.name,
    assigned.name,
    inPattern.name,
    inList.name,
    takes(),
    returns().name,
    holder.member.name,
    new Holder().field.name,
    underAText.name,
    optional.name,
  ]),
);
exports.first = [() => {}][0];
const element = [() => {}][0];
let later;
later = [function () {}][0];
const { fromList = [() => {}][0] } = {};
const keeper = { member: [class {}][0] };
const second = [0, () => {}][1];
console.log(
  spell([exports.first.name, element.name, later.name, fromList.name, keeper.member.name, second.name]),
);
