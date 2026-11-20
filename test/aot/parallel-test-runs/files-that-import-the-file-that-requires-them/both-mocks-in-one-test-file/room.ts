import { width } from "./door";
const lamp = require("./lamp");
export const floor = 2;
export function size(value: number) { return value * floor * width() + lamp.light(); }
export function floorByLamp() { return lamp.floorOfRoom(); }
