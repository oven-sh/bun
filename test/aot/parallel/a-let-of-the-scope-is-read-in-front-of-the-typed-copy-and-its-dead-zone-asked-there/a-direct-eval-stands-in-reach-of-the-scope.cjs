// A direct eval in the function around may store the variable under its name.
// STATISTIC: CapturedVariableReadsHoisted = 0
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
function make() {
  let letters = "aaaaaa";
  let seen = 0;
  function codeAt(at) { return letters.charCodeAt(at); }
  function run(text) { let sum = 0; for (seen = 0; seen < 6; ++seen) { sum += codeAt(seen); if (seen === 2) eval(text); } return sum + ":" + letters; }
  return run;
}
globalThis.kept = make();
tell(() => globalThis.kept("letters = 'bbbbbb'")); tell(() => globalThis.kept("0")); tell(() => globalThis.kept("letters = 7"));
console.log(said.join(" | "));
