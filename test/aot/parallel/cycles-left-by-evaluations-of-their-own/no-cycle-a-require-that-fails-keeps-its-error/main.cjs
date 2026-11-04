const errors = [];
for (let turn = 0; turn < 3; turn++) {
  try { console.log(require("./top.mjs").ok); } catch (error) { errors.push(error); console.log("top:", error.message, error === errors[0]); }
}
console.log("below:", require("./below.mjs").ok);
