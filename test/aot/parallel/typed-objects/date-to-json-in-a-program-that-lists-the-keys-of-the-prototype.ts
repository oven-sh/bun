// CALLS+ write operationAOTDateToISOString
// COUNT: operation:operationAOTDateToISOString = 2
// toJSON writes a valid date in place, and Date.prototype still gets valueOf and toISOString where the built-in function reads them: valueOf for every date, toISOString for a valid one.
export function write(date: Date): string | null { return date.toJSON(); }
const report = (run: () => unknown) => {
  try { console.log(run()); } catch (error) { console.log((error as Error).name); }
};
report(() => new Date(0).getDay());
report(() => write(new Date(NaN)));
report(() => new Date(0).setUTCHours(1));
report(() => write(new Date(0)));
report(() => new Date(0).getUTCDay());
report(() => write(new Date(86400000)));
report(() => new Date(0).getHours() >= 0);
report(() => Object.values(Date.prototype).length);
report(() => Object.getOwnPropertyNames(Date.prototype).join());
