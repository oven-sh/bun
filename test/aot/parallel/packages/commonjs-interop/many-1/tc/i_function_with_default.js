import d from "i_function_with_default";
import * as ns from "i_function_with_default";
export const seen = [typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name), Object.keys(ns).filter((k) => k !== "__esModule").sort().join()];
