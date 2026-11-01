// Flags: --aot-limit=MaxWarmCodeValues:1
// Each record of a list holds a list of its own. Behind structuredClone a push into the first record's list leaves the second's as long as it was. The records come from new Array(2).fill(0).map(); the function is called twice.
function makeDraft() {
  const teams = new Array(2).fill(0).map((_, i) => ({ name: "t" + i, roles: ["user"] }));
  const draft = structuredClone(teams);
  draft[0].roles.push("admin");
  return draft[0].roles.length + " " + draft[1].roles.length;
}
console.log(makeDraft());
console.log(makeDraft());
