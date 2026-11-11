// a function that a later case declares is there when the switch is entered: a closure of an earlier case reads and calls it, and the later case never runs
function pick(which) {
  const kept = [];
  switch (which) {
    case 0:
      kept.push(() => typeof late + " " + late());
      break;
    case 1:
      function late() {
        return "late";
      }
  }
  try {
    return kept[0]();
  } catch (error) {
    return error.name;
  }
}
console.log(pick(0));
