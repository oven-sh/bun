export function make(n) {
  return n % 2 ? new Error("outside " + n) : { message: "outside " + n };
}
export const list = [new TypeError("listed"), { message: "listed" }];
