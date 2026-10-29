interface Holder {
  missing: number;
}
type Maybe = Holder | null;
const nothing = null as Maybe;
const size = 60;
export function read() {
  return nothing!.missing;
}
export function call(value: any) {
  return value(size);
}
