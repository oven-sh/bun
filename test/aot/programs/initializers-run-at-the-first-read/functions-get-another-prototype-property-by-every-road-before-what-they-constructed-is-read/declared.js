import { change } from "./main.js";
function Stored() {}
function Defined() {}
function Reflected() {}
function Assigned() {}
function Keyed() {}
function Held() {}
function Listed() {}
function Third() {}
function Called() {}
function make() {
  return new Stored();
}
export { Assigned, Called, Defined, Held, Keyed, Listed, Reflected, Stored, Third };
export const stored = make();
export const defined = new Defined();
export const reflected = new Reflected();
export const assigned = new Assigned();
export const keyed = new Keyed();
export const held = { meter: new Held(), beside: [1, 2, 3] };
export const listed = [new Listed(), new Listed()];
export const third = new Third();
export const called = new Called();
change(Called);
