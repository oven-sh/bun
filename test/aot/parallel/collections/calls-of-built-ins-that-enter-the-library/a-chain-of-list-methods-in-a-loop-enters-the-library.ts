// STATISTIC: LibraryFunctionsCalledDirectly >= 3
// STATISTIC: CallbackChainsFused >= 1
// filter, map and reduce on a list that stays as made, each handed an arrow that calls nobody, in a loop: all three stand in line, and what filter and map make are new lists.
type Parcel = { weight: number; pieces: number; sent: boolean };
function heaviest(rounds: number) {
  const parcels: Parcel[] = [];
  for (let i = 0; i < 40; i++) parcels.push({ weight: i * 3, pieces: i & 3, sent: (i & 1) === 0 });
  let total = 0;
  for (let round = 0; round < rounds; round++)
    total += parcels.filter(parcel => parcel.sent).map(parcel => parcel.weight * parcel.pieces).reduce((sum, value) => sum + value, round);
  return total;
}
console.log(heaviest(50));
