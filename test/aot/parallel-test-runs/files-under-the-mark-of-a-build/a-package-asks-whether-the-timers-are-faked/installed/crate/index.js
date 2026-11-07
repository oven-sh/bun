// @bun
export function timersAreFaked() {
  if (typeof jest !== "undefined" && jest !== null) {
    return setTimeout._isMockFunction === true || Object.prototype.hasOwnProperty.call(setTimeout, "clock") ? "faked" : "real";
  }
  return "no runner";
}
export const actsAsUnderTheRunner = "undefined" !== typeof jest ? "under the runner" : "by itself";
