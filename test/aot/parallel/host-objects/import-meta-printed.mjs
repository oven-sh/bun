// The table lists every member of import.meta and says where a lookup goes on, so the printer, JSON.stringify and String find nothing on it that nobody knows and util.inspect stays out.
// STATISTIC: ImageFunctionsEmitted <= 8
console.log(import.meta);
console.log(JSON.stringify(import.meta), String(import.meta), Object.keys(import.meta), Reflect.ownKeys(import.meta));
console.log(import.meta.nothing, "nothing" in import.meta, typeof import.meta.url, typeof import.meta.main);
