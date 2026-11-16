import { cat } from "./cat.js";
import "./eel.js";
import * as all_bee from "./bee.js";
const state_ant = "ant ";
export const ant = () => "(" + state_ant + cat() + all_bee.bee() + ")";
