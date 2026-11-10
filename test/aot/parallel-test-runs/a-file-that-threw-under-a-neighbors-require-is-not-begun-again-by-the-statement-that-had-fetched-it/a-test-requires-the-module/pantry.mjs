import "./stove.cjs";
import * as kettle from "./kettle.cjs";
export const pantry = "pantry sees " + JSON.stringify(Object.keys(kettle)) + " " + JSON.stringify(kettle.default);
