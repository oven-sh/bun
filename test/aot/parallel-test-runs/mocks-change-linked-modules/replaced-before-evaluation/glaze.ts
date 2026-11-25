import { isOn, tint } from "./tint";
export const glaze = () => "glaze " + typeof tint + " " + (isOn ? "on" : "off");
