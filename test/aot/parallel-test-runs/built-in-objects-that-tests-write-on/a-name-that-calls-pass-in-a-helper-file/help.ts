function put(name: string, value: string) { Object.defineProperty(Object.prototype, name, { value, configurable: true }); }
function take(name: string) { Reflect.deleteProperty(Object.prototype, name); }
export const pollute = () => { put('helped', 'x'); };
export const clean = () => { take('helped'); };
