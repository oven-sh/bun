// Under `bun run` the call throws: "ReferenceError".
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
/* Output:
function late
*/
