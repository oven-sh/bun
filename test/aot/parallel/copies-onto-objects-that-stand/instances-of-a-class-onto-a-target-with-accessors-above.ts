const log: string[] = [], key = (t: string): any => JSON.parse(JSON.stringify(t));
function show(o: any): string { return Reflect.ownKeys(o).map(k => String(k) + "=" + String(o[k])).join(","); }
class Fields { request = 7; user = "c"; inner: number[] = [1]; }
const left = new Fields(); (left as any)[key("request")] = "text";
const above = { set user(v: string) { log.push("set"); }, get request() { log.push("get"); return -1; } };
function onto(list: Fields[]) { const out: string[] = []; for (let i = 0; i < list.length; i++) out.push(show({ __proto__: above, user: "first", tail: 0, ...({} as any), ...(list[i] as any) })); return out; }
function rest(list: Fields[]) { const out: string[] = []; for (let i = 0; i < list.length; i++) { const { user, ...others } = list[i]; out.push(user + ":" + show(others)); } return out; }
const list = [new Fields(), left, new Fields()];
console.log("SAID " + onto(list).join("|") + " # " + rest(list).join("|") + " # " + log.length);
export {};
