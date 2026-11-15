export const FIXED = "return 'fixed';";
export let CHANGING = "return 'before';";
export const LATER = [1, 2].map(n => "return " + n + ";")[process.argv.length > 100 ? 1 : 0]!;
export const object = { text: "return 'of an object';" };
export function change() {
  CHANGING = "return 'after';";
  object.text = "return 'of the changed object';";
}
export function read() {
  return CHANGING + "//";
}
