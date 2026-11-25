export const FIXED = "return 'fixed';";
export const TEXT = ["return 'joined", "';"].join(process.argv.length > 100 ? "-" : "");
export let CHANGING = 1;
export const COUNT = 12;
export const LIMIT = 0.1 + 0.2;
export const HUGE = 9007199254740993n;
export const NONE = undefined;
export const ODD = 0 / 0;
export const settings = { text: "return 'of settings';", limit: 20 };
export function change() {
  CHANGING = 2;
}
export default "return 'the default';";
