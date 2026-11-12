// A helper is handed texts, numbers, booleans and one kind of record; it asks typeof itself and steps through the record by for-in.
// Every answer is plain Bun's.
const rows = JSON.parse('[{"on":true,"qty":3},{"on":false,"qty":1},{"on":true,"qty":0}]');
function words(mix) { let k, text = ''; if (typeof mix === 'string' || typeof mix === 'number') text += mix; else if (typeof mix === 'object') { for (k in mix) if (mix[k]) { text && (text += ' '); text += k; } } return text; }
function joined(...args) { let text = ''; for (const a of args) { const x = a && words(a); if (x) { text && (text += ' '); text += x; } } return text; }
for (let turn = 0; turn < 2; turn++) for (const r of rows) console.log(joined('btn', { on: r.on, off: !r.on }, r.qty > 2 && 'many', turn));
