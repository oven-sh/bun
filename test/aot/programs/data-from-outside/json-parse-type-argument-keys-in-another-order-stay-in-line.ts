// An order of declared keys that was seen before is laid on the new object by the compiled parser itself: the engine is not called.
// IR+ ^ .*JSONKeyOrderAppend
// IR+ ^ .*JSONKeyOrderApply
declare const aotOperationCount: undefined | ((name: string) => number);
interface Point { x: number; y: number; label?: string }
interface Segment { id: number; from: Point; to: Point; tags: string[] }
interface Fourteen { k0: number; k1: number; k2: number; k3: number; k4: number; k5: number; k6: number; k7: number; k8: number; k9: number; k10: number; k11: number; k12: number; k13: number }

const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const count = (name: string) => (counted ? counted(name) : 0);
function measure(what: string, texts: string[], parse: (text: string) => unknown, callsExpected: number): void {
  for (let i = 0; i < 8; i++) for (const text of texts) parse(text);
  const [called, readAgain] = [count("operationAOTJSONKeyOrderApply"), count("operationAOTJSONSourceAbandon")];
  for (const text of texts) parse(text);
  console.log(what, counted ? count("operationAOTJSONKeyOrderApply") - called === callsExpected && count("operationAOTJSONSourceAbandon") === readAgain : true);
}
const segment = (text: string) => JSON.parse(text) as Segment;
measure("declared order", ['{"id":1,"from":{"x":1,"y":2},"to":{"x":1,"y":2},"tags":[]}'], segment, 0);
measure("another order", ['{"tags":[],"to":{"y":2,"x":1},"from":{"label":"l","y":2,"x":1},"id":1}'], segment, 0);
measure("declared order, spaced", ['{ "id": 1, "from": { "x": 1, "y": 2 }, "to": { "x": 1, "y": 2 }, "tags": [] }'], segment, 0);
measure("four orders in turn", ['{"tags":[],"to":{"y":2,"x":1},"from":{"y":2,"x":1},"id":1}', '{"to":{"y":2,"x":1},"tags":[],"from":{"x":1,"y":2},"id":1}', '{"from":{"x":1,"y":2},"id":1,"to":{"y":2,"label":"l","x":1},"tags":[]}', '{"id":1,"tags":[],"from":{"x":1,"y":2},"to":{"x":1,"y":2}}'], segment, 0);
measure("an undeclared key: one call for its object", ['{"tags":[],"to":{"y":2,"x":1},"from":{"y":2,"o":1,"x":1},"id":1}'], segment, 1);
measure("more members than one word holds: one call", ['{"k13":13,"k12":12,"k11":11,"k10":10,"k9":9,"k8":8,"k7":7,"k6":6,"k5":5,"k4":4,"k3":3,"k2":2,"k1":1,"k0":0}'], text => JSON.parse(text) as Fourteen, 1);
