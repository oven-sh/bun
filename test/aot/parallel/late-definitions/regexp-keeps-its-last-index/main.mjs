// What is made late is one object, with the name, the length, the state and the properties of one that was made where it stands.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { step, read } from "./m.mjs";
say(() => [step("aaa"), step("aaa"), read().lastIndex, step("aaa"), step("aaa")].join());
