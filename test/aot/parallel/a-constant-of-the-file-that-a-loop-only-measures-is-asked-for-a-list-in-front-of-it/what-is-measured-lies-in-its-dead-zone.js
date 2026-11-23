const weights = JSON.parse("[0.5, 53.5, 106.5, 159.5]");
function tally(start) {
  let total = start;
  for (let i = 0; i < rows.length; i++) total += weights[i];
  return total;
}
const byName = { tally };
const name = JSON.parse('"tally"');
const said = [];
try { said.push(byName[name](1)); } catch (error) { said.push(error.name); }
const rows = JSON.parse("[7, 8, 9]");
said.push(byName[name](1));
console.log(said.join(" "));
