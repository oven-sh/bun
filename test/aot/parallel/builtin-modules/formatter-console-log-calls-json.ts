// console.log prints some objects of the host by what their toJSON answers. It calls what it finds under the name, on the object and with no operand; a function that only it calls is in the program.
const say = (...values: unknown[]) => console.log(...values);
const headers = new Headers({ a: "1" }); say(headers);
(headers as any).toJSON = function (this: Headers, ...operands: unknown[]) { say("toJSON of the program ran", operands.length, this === headers); return { replaced: true, inner: { toJSON() { say("never run"); return 1; } } }; };
say(headers); say(Bun.inspect(headers).length > 0);
const params = new URLSearchParams("x=1&y=2"); say(params);
(params as any).toJSON = () => ["from", "an", "arrow"]; say(params);
const form = new FormData(); form.append("k", "v"); say(form);
Object.defineProperty(form, "toJSON", { value: function () { return { size: arguments.length }; } }); say(form);
say(JSON.parse('{"a":[1,{"b":null}],"toJSON":1}'), JSON.parse("[1,2]"), JSON.parse('"text"'), { toJSON() { say("never run either"); return 1; } });
try { (headers as any).toJSON = () => { throw new RangeError("from toJSON"); }; say(headers); } catch (e) { say((e as Error).name); }
