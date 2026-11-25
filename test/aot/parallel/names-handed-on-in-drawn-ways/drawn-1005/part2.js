import * as in2_all_0 from "./part3.js";
import { space as in2_1 } from "./part3.js";
import * as in2_all_2 from "./part4.js";
export * from "./part0.js";
export * from "./part1.js";
export { own0_0 as again2_0 } from "./part0.js";
import { n5 as taken_1_n5 } from "./part1.js";
export { taken_1_n5 as n5 };
export { own0_1 as n1 } from "./part0.js";
export let own2_0 = function () { return "own2_0@part2 on " + (this === undefined ? "nothing" : Object.keys(this).join("+")); };
export function n2() { return "n2@part2()"; }
export default "default@part2";
export function use2() {
  try { console.log('Object.keys(in2_all_0).join()', String(Object.keys(in2_all_0).join())); } catch (error) { console.log('Object.keys(in2_all_0).join()', "threw", error.constructor.name); }
  try { console.log('in2_all_0.own4_0()', String(in2_all_0.own4_0())); } catch (error) { console.log('in2_all_0.own4_0()', "threw", error.constructor.name); }
  try { console.log('typeof in2_1.missing', String(typeof in2_1.missing)); } catch (error) { console.log('typeof in2_1.missing', "threw", error.constructor.name); }
  try { console.log('in2_1.own0_1()', String(in2_1.own0_1())); } catch (error) { console.log('in2_1.own0_1()', "threw", error.constructor.name); }
  try { console.log('in2_1.space.n2()', String(in2_1.space.n2())); } catch (error) { console.log('in2_1.space.n2()', "threw", error.constructor.name); }
  try { console.log('Object.keys(in2_1.space.n3).join()', String(Object.keys(in2_1.space.n3).join())); } catch (error) { console.log('Object.keys(in2_1.space.n3).join()', "threw", error.constructor.name); }
  try { console.log('Object.keys(in2_1.space.n3.space).join()', String(Object.keys(in2_1.space.n3.space).join())); } catch (error) { console.log('Object.keys(in2_1.space.n3.space).join()', "threw", error.constructor.name); }
  try { console.log('typeof in2_all_2.missing', String(typeof in2_all_2.missing)); } catch (error) { console.log('typeof in2_all_2.missing', "threw", error.constructor.name); }
  try { console.log('in2_all_2.n3.own4_0()', String(in2_all_2.n3.own4_0())); } catch (error) { console.log('in2_all_2.n3.own4_0()', "threw", error.constructor.name); }
  try { console.log('in2_all_2.n3.own0_0()', String(in2_all_2.n3.own0_0())); } catch (error) { console.log('in2_all_2.n3.own0_0()', "threw", error.constructor.name); }
}
