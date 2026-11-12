const stages = ["idle", "busy", "done"];
var stage = 0;
function advance() {
  if (stage < 2) stage++;
  return stages[stage];
}
console.log(advance(), advance(), advance());
var place = 0;
const weights = [10, 20, 30];
function next() {
  place++;
}
console.log(weights[place]);
next();
console.log(weights[place], "text"[place], new Uint8Array([7, 8])[place]);
