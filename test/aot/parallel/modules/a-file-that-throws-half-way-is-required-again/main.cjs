const said = [];
for (let turn = 0; turn < 3; turn++) {
  try { said.push(typeof require("./half.cjs")); } catch (error) { said.push(error.message); }
}
console.log(said.join(" | "));
