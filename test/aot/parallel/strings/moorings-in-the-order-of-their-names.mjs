// The moorings of a harbor in the order of their names, by the order of the place: twice, so that the second sort finds what the first has learned of it.
const harbor = { pier: 4, basin: 2, Quay: 9, anchorage: 1, "écluse": 3, dock: 7, berth: 5, "": 6 };
function ordered(moorings) {
  return Object.keys(moorings).sort((a, b) => a.localeCompare(b));
}
const said = [];
for (let day = 0; day < 40; day++) said.push(ordered(harbor).join() + (day & 1 ? "" : Object.keys(harbor).map(name => "dock".localeCompare(name)).join()));
console.log(new Set(said).size, said[0], said[1]);
