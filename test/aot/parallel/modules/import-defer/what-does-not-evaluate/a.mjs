console.log("a is evaluated");
export let value = 1;
export function bump() {
  return ++value;
}
export const arrow = () => value;
export const LIMIT = 10;
export class Thing {
  static made = 0;
  constructor() {
    Thing.made++;
  }
}
export default "the default of a";
