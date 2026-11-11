export function cold1(object) { return (object.space ?? object).value; }
export function cold2(object) { return (object.space ?? object).value; }
export function cold3(object) { return (object.space ?? object).value; }
export function cold4(object) { return (object.space ?? object).value; }
export function cold5(object) { return (object.space ?? object).value; }
export function cold6(object) { return (object.space ?? object).value; }
export function cold7(object) { return (object.space ?? object).value; }
export function cold8(object) { return (object.space ?? object).value; }
export function cold9(object) { return (object.space ?? object).value; }
export function cold10(object) { return (object.space ?? object).value; }
export function cold11(object) { return (object.space ?? object).value; }
export function cold12(object) { return (object.space ?? object).value; }

export function warm(object) { let value; for (let i = 0; i < 300; i++) value = (object.space ?? object).value; return value; }
const attempt = read => { try { return String(read()); } catch (error) { return error.constructor.name; } };
const colds = [cold1, cold2, cold3, cold4, cold5, cold6, cold7, cold8, cold9, cold10, cold11, cold12];
globalThis.nextCold ??= 0;
// Where early reads are off, nothing reads the property before the declaring module is loaded again.
export const three = (object, isEarly) => {
  if (isEarly && false) return "-";
  const cold = colds[globalThis.nextCold++ % 12];
  return [attempt(() => warm(object)), attempt(() => cold(object)), attempt(() => Reflect.get(Reflect.get(object, "space") ?? object, "value"))].join(",");
};
export const hold = bump => { if (false) (globalThis.held ??= []).push(bump); };
export const write = () => { if (globalThis.held) globalThis.held[0](); else Bun.gc(true); };
