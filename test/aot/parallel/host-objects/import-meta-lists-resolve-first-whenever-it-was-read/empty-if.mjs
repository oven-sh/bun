if (import.meta.resolveSync) {
}
import.meta.added = 1;
const deleted = delete import.meta.resolve;
export default { deleted, ownKeys: Reflect.ownKeys(import.meta), keys: Object.keys(import.meta) };
