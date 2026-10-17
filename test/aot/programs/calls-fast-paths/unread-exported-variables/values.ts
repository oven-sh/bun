const made: string[] = [];
function note(what: string): string { made.push(what); return what; }
export function whatWasMade(): string { return made.join(","); }

export const unreadArrow = (): string => "only in the unread arrow";
export const unreadList: string[] = ["only in the unread list"];
export const unreadButMadeByACall: string = note("the call is carried out");
export let unreadAndStoredLater = 0;
export function storesLater(): void { unreadAndStoredLater++; note("stored later"); }

export const readByName = (): string => "read by name";
export const readByTheModuleItself: string[] = ["read by the module itself"];
export function readsItsOwn(): string { return readByTheModuleItself[0]; }
export const readByAnImport = (): string => "read by an import";
export let counted = 0;
export function count(): void { counted++; }
