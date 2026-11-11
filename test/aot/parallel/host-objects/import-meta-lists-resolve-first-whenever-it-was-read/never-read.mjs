import.meta.added = 1;
const { added, ...rest } = import.meta;
export default { rest: Object.keys(rest), assigned: Object.keys(Object.assign({}, import.meta)), ownKeys: Reflect.ownKeys(import.meta) };
