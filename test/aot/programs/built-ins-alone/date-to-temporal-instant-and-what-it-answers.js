const date = new Date(86400000.5);
const result = date.toTemporalInstant();
console.log(typeof result, Object.keys(result).join());
