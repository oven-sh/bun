// An earlier compiler counted the list literals that are never changed and never told apart: FlowListsNeverToldApart = 0. Nothing finds such lists today: shared-rows.mjs waits for it.
const rows = [0, 1, 2].map(() => [1, 2, 3]);
console.log(`${rows[0] === rows[1]} ${rows[0][2]}`);
