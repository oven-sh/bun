export function makeParcels(count) {
  const parcels = [];
  for (let i = 0; i < count; i++) parcels.push({ parcelWeight: i, parcelZone: 2 });
  return parcels;
}
