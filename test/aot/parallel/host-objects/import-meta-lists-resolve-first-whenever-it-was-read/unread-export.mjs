export const nothingImportsThis = import.meta.resolveSync;
import.meta.added = 1;
export default { entries: Object.entries(import.meta).map(([name]) => name), ownKeys: Reflect.ownKeys(import.meta) };
