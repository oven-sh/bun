// What an async function gives is a copy of an object that Object.fromEntries() has made.
// Under: --aot-check=FlowFixpoint: who awaited it was not told of all that the copy holds, and the flow was not closed.
const rows = JSON.parse('[{"id":7},{"id":8,"tags":["x"]},{"name":null}]');
async function copied(row) {
  return { ...Object.fromEntries(Object.entries(row)) };
}
async function copiedBehindAnAwait(row) {
  const flags = Object.fromEntries(Object.keys(row).map(key => [key, true]));
  await null;
  return { ...flags, first: row.id };
}
function withoutId(row) {
  const { id, ...others } = Object.fromEntries(Object.entries(row));
  return others;
}
for (const row of rows) console.log(JSON.stringify([await copied(row), await copiedBehindAnAwait(row), withoutId(row)]));
