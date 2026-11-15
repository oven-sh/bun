import "./stove.cjs";
import * as kettle from "./kettle.cjs";
import "./ladle.cjs";
export const pantry = "pantry sees " + JSON.stringify(Object.keys(kettle)) + " " + JSON.stringify(kettle.default);
