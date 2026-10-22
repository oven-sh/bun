// The same through a name that is put together at run time and a function that nobody follows.
function isResponse(x) { return x instanceof Response; }
function isURL(x) { return x instanceof URL; }
const values = [new Response("a"), new URL("http://a/"), {}, 5];
const ask = () => values.map(value => +isResponse(value) + "" + +isURL(value)).join();
for (let i = 0; i < 50; i++) ask();
console.log(ask());
const names = JSON.parse('["Res","ponse","UR","L"]');
const define = JSON.parse('["define","Property"]').join("");
for (const name of [names[0] + names[1], names[2] + names[3]]) {
  try { Object[define](globalThis[name], Symbol[JSON.parse('"hasInstance"')], { value: x => x === 5, configurable: true }); console.log("defined"); } catch (error) { console.log("refused", error.name); }
}
console.log(ask());
