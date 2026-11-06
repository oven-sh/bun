// An order of declared keys that was seen before is laid on the new object by the compiled parser itself: the engine is not called.
// Each declared key adds itself to the order as it is met, and the order is laid on the object where the object ends. Of the 81 texts that are parsed, nine hold an object with an undeclared key. The first of them calls the engine where that object ends.
// From the second on the engine knows the names of that object: one call parses it whole and lays its order on it. None is given up and read again.
// IR+ ^ .*: keyorder = JSONObjectKey v[0-9]+ layout=L[0-9]+
// IR+ ^ .* = JSONObjectFinish v[0-9]+, v[0-9]+, v[0-9]+ layout=L[0-9]+
// COUNTER: operationAOTJSONSourceOpen = 81
// COUNTER: operationAOTJSONObjectFinish = 1
// COUNTER: operationAOTJSONSourceAbandon = 0
// Env: JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number);
interface Point { x: number; y: number; label?: string }
interface Segment { id: number; from: Point; to: Point; tags: string[] }
interface Fourteen { k0: number; k1: number; k2: number; k3: number; k4: number; k5: number; k6: number; k7: number; k8: number; k9: number; k10: number; k11: number; k12: number; k13: number }

const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const count = (name: string) => (counted ? counted(name) : 0);
function measure(what: string, texts: string[], parse: (text: string) => unknown, objectsAskedForWhole: number): void {
  for (let i = 0; i < 8; i++) for (const text of texts) parse(text);
  const [finished, asked, readAgain] = [count("operationAOTJSONObjectFinish"), count("operationAOTJSONParseExtraMembers"), count("operationAOTJSONSourceAbandon")];
  for (const text of texts) parse(text);
  console.log(what, counted ? count("operationAOTJSONObjectFinish") === finished && count("operationAOTJSONParseExtraMembers") - asked === objectsAskedForWhole && count("operationAOTJSONSourceAbandon") === readAgain : true);
}
const segment = (text: string) => JSON.parse(text) as Segment;
measure("declared order", ['{"id":1,"from":{"x":1,"y":2},"to":{"x":1,"y":2},"tags":[]}'], segment, 0);
measure("another order", ['{"tags":[],"to":{"y":2,"x":1},"from":{"label":"l","y":2,"x":1},"id":1}'], segment, 0);
measure("declared order, spaced", ['{ "id": 1, "from": { "x": 1, "y": 2 }, "to": { "x": 1, "y": 2 }, "tags": [] }'], segment, 0);
measure("four orders in turn", ['{"tags":[],"to":{"y":2,"x":1},"from":{"y":2,"x":1},"id":1}', '{"to":{"y":2,"x":1},"tags":[],"from":{"x":1,"y":2},"id":1}', '{"from":{"x":1,"y":2},"id":1,"to":{"y":2,"label":"l","x":1},"tags":[]}', '{"id":1,"tags":[],"from":{"x":1,"y":2},"to":{"x":1,"y":2}}'], segment, 0);
measure("an undeclared key: one call for each object of its type whose keys are not in the declared order", ['{"tags":[],"to":{"y":2,"x":1},"from":{"y":2,"o":1,"x":1},"id":1}'], segment, 2);
measure("more members than one word holds", ['{"k13":13,"k12":12,"k11":11,"k10":10,"k9":9,"k8":8,"k7":7,"k6":6,"k5":5,"k4":4,"k3":3,"k2":2,"k1":1,"k0":0}'], text => JSON.parse(text) as Fourteen, 0);
