// A function that is declared below is called above the statement that makes the object: the variable holds undefined, and the read throws.
function early() {
  try { return Stage.First; } catch (error) { return error instanceof TypeError ? "TypeError" : String(error); }
}
console.log(early());
var Stage;
(function (Stage) {
    Stage[Stage["First"] = 1] = "First";
    Stage[Stage["Last"] = -1] = "Last";
})(Stage || (Stage = {}));
console.log(early(), Stage.Last, typeof Stage);
