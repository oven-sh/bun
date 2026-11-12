// A with round the loop: the name may belong to the object.
// None is hoisted here; one is in a function of the library that the image holds.
// STATISTIC: CapturedVariableReadsHoisted <= 1
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
function make() {
  let letters = "aaaaaa";
  function run(scope) { let sum = 0; with (scope) { for (let at = 0; at < 6; ++at) { sum += letters.charCodeAt(at); if (at === 2) scope.letters = "cccccc"; } } return sum; }
  return run;
}
globalThis.kept = make();
tell(() => globalThis.kept({})); tell(() => globalThis.kept({ letters: "bbbbbb" })); tell(() => globalThis.kept({}));
console.log(said.join(" | "));
