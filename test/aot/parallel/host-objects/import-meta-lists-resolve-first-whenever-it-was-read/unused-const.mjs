const unused = import.meta.resolveSync;
import.meta.added = 1;
export default { spread: Object.keys({ ...import.meta }), ownKeys: Reflect.ownKeys(import.meta) };
