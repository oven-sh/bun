export const lookAlike = {
  length: 2,
  charCodeAt(index) {
    return index + 1;
  },
  split() {
    return [["first"], { 0: "second" }];
  },
  slice() {
    return "sliced";
  },
  toString() {
    return "look alike";
  },
};

export const wrapped = new String("hello world");
export const list = ["hello", "world", "and", "more", "and", "more"];
export const number = 1234567;
export let changing = "a text at first";

export function change() {
  changing = ["now", "a", "list"];
}
