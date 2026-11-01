// Flags: --aot-validate
let log = "";
const above = {};
try {
const o = { __proto__: above, 0: 2 };
console.log(`${o}`);
o[0]++;
Object.setPrototypeOf(o.__proto__, {
get 0() {
log += "get ";
return "got";
},
set 0(given) {
log += "set ";
},
});
console.log(Object.keys(o).join());
{
const { 0: taken } = o;
console.log(taken);
}
o[0] = null;
console.log(o[0]);
console.log(log);
} catch (error) {
console.log("THROWS", error.constructor.name);
}
