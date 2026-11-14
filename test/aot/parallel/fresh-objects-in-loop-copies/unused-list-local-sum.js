// Under: --aot-check=Validate: the copies of a loop that begin late know the objects made in front
const rates = JSON.parse("[2,4,6,8,10,12]");
function tally(input) {
  let extra = 0;
  let total = 0;
  const spare = [];
  const rows = Array.from(input);
  for (let i = rows.length - 1; i >= 0; i--) {
    total += rows[i];
    for (let j = 0; j < rows.length; j++) total += rows[j];
    extra += rates[i];
  }
  return spare.length + extra + "/" + total;
}
console.log(tally(JSON.parse("[1,2,3,4,5]")));
