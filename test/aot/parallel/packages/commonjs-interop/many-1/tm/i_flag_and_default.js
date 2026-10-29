import d from "i_flag_and_default";
import * as ns from "i_flag_and_default";
export const seen = [typeof d, typeof d === "object" && d ? Object.keys(d).join() : String(d && d.name), Object.keys(ns).filter((k) => k !== "__esModule").sort().join()];
