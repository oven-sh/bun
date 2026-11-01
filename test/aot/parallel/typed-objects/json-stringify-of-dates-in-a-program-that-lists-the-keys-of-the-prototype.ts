// CALLS+ writeRow operationAOTJSONAppendDate
// JSON.stringify writes a typed date in place, and Date.prototype still gets toJSON, valueOf and toISOString where the built-in functions read them: toISOString for a valid date alone.
type Row = { when: Date };
export function writeRow(row: Row): string { return JSON.stringify(row); }
const report = (run: () => unknown) => {
  try { console.log(run()); } catch (error) { console.log((error as Error).name); }
};
report(() => new Date(1).getDay());
report(() => writeRow({ when: new Date(NaN) }));
report(() => new Date(1).getUTCDay());
report(() => writeRow({ when: new Date(5) }));
report(() => new Date(1).getHours() >= 0);
report(() => writeRow({ when: new Date(86400000) }));
report(() => Object.values(Date.prototype).length);
report(() => Object.getOwnPropertyNames(Date.prototype).join());
