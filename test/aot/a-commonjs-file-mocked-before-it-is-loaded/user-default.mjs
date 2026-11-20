import whole from "./a.cjs";
export const seen = () => typeof whole + " " + (whole && Object.keys(whole).join());
