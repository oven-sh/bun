const it = (async function* () {})(); await it.next(); export const v = (await it.next()).done;
