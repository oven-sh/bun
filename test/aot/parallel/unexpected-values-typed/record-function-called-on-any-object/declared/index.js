export const pass = Function("value", "return value");
export function put(target, key, value) {
  target[key] = value;
}
export function attempt(act) {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
}
export class Part {}
export function walk(holder, turns) {
  let text = "";
  for (let i = 0; i < turns; i++) text += (holder.part.count > 100 ? "" : holder.part.read(i)) + ",";
  return text;
}
export const record = { open: null, port: 80, host: "h", read: i => "record" + i, count: 5 };
export const holder = { id: 0, part: new Part() };
export class Other {
  read(i) {}
}
export const otherHolder = { id: 1, part: new Other() };
