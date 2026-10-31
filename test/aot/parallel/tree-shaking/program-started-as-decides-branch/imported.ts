function whenMain() { return "imported.ts is the entry point"; }
function whenNotMain() { return "imported.ts is not the entry point"; }

export const fromImported = import.meta.main ? whenMain() : whenNotMain();
