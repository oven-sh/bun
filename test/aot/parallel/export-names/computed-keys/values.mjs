export const firstAlone = 1;
export function secondAlone() { return "second"; }
export let aaaAlone = [1, 2].length;
const value = "with a space";
export { value as "with space", value as "ünï \u{1F600}", value as "日本" };
export default "the default";
export const zetaAlone = null;
