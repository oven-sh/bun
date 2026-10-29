export const Below = class extends Proxy {};
export function read() {
  return Below;
}
console.log("reached");
