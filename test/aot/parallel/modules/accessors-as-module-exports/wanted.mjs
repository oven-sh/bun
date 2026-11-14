import colors from "./by-getter.cjs";
export const wanted = new RegExp(process.env.ACCESSORS_WANTED ?? "re+d|" + colors.green, "i");
