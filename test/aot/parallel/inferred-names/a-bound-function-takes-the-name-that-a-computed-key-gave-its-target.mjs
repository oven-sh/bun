// The name of a bound function is "bound " and the name of its target, whichever way the target got that name. The language says so, and Node.js answers so.
// `bun run` leaves the name out where the target was named by a key in brackets.
const key = ["g"][0];
const subject = { ["f"]() {}, [key]() {}, ["a"]: () => {}, ["h"]: function () {}, get ["v"]() { return 1; }, plain() {} };
for (const name of ["f", "g", "a", "h", "plain"]) console.log(name, JSON.stringify(subject[name].name), JSON.stringify(subject[name].bind(subject).name));
class K { ["m"]() {} static ["s"]() {} }
console.log(JSON.stringify(new K().m.bind(null).name), JSON.stringify(K.s.bind(null).name));
/* Output:
f "f" "bound f"
g "g" "bound g"
a "a" "bound a"
h "h" "bound h"
plain "plain" "bound plain"
"bound m" "bound s"
*/
