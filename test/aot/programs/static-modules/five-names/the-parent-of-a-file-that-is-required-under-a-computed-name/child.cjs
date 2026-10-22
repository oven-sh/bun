module.parent.exports.limit = 7;
module.parent.exports.bump(3);
const said = [];
exports.step = 1;
exports.note = text => said.push(text);
exports.notes = () => said.join();
exports.read = () => {
  let sum = 0;
  for (let round = 0; round < 100; round++) sum += exports.step;
  return sum;
};
