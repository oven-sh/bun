// answers: without-library
// # an access under a key that the body writes is the access by that name: it finds fields, accessors, getters of literals, what strings and lists answer, throws for null, is refused by a frozen object, and keeps the order of keys.
// # an element key and `__proto__` go by the value. A key that begins with "on" never names the prototype link, one that begins with "__" may.
// # the front end names the property where it lowers the key to a string (lower/member/key.rs), so Link lists undefined, null and true
// # f1 = kindOf, f6 = underUndefined, f7 = underNull, f8 = underTrue, f13 = listen, f14 = hide
// # RUN(FORM): link accesses mechanisms=all
// # FORM: access f6 {{*}} under "undefined"
// # FORM: access f7 {{*}} under "null"
// # FORM: access f8 {{*}} under "true"
// # RUN(NEVER): walk f1 f6 mechanisms=all
// # NEVER-NOT: ElemGet
// # with Folding withheld Link lists none of them. There TypedOperations reads a key that is one written text off the body by itself, so in the walk that is withheld too
// # RUN(UNLISTED): link accesses mechanisms=-Folding
// # UNLISTED-NOT: under "undefined"
// # UNLISTED-NOT: under "null"
// # RUN(WITHHELD): walk f6 f7 mechanisms=-Folding-TypedOperations
// # WITHHELD-LABEL: code f6:Body
// # WITHHELD: = ElemGet
// # WITHHELD-LABEL: code f7:Body
// # WITHHELD: = ElemGet
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 36 of 36 of 36
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Item { kind: string; size: number; constructor(kind: string, size: number) { this.kind = kind; this.size = size; } get twice() { return this.size * 2; } set twice(v: number) { this.size = v / 2; } }
function kindOf(node: any) { let k; k = "kind"; return node[k]; }
function setKind(node: any, v: unknown) { let k; k = "kind"; node[k] = v; }
function twiceOf(node: any) { let k; k = "twice"; return node[k]; }
function setTwice(node: any, v: unknown) { let k; k = "twice"; node[k] = v; }
function hasKind(node: any) { let k; k = "kind"; return k in node; }
function underUndefined(o: any) { return o[undefined as any]; }
function underNull(o: any) { return o[null as any]; }
function underTrue(o: any) { return o[true as any]; }
function first(o: any) { let k; k = "0"; return o[k]; }
function above(o: any) { let k; k = "__proto__"; return o[k]; }
function setAbove(o: any, v: unknown) { let k; k = "__proto__"; o[k] = v; }
function lengthOf(o: any) { let k; k = "length"; return o[k]; }
function listen(o: any, kind: string, f: unknown) { o["on" + kind] = f; }
function hide(o: any, rest: string, v: unknown) { o["__" + rest] = v; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
const node = new Item("a", 2);
tell(() => kindOf(node));
tell(() => { setKind(node, "b"); return node.kind; });
tell(() => { setKind(node, 7); return typeof node.kind; });
tell(() => twiceOf(node));
tell(() => { setTwice(node, 10); return node.size; });
tell(() => hasKind(node));
tell(() => hasKind({}));
tell(() => kindOf({ kind: "literal" }));
tell(() => kindOf({ get kind() { return "getter"; } }));
tell(() => kindOf("text"));
tell(() => kindOf(null));
tell(() => kindOf(undefined));
tell(() => { setKind(null, 1); return "stored"; });
tell(() => { const frozen = Object.freeze({ kind: "kept" }); setKind(frozen, "lost"); return frozen.kind; });
tell(() => { delete (node as any).kind; return kindOf(node); });
tell(() => { setKind(node, "again"); return Object.keys(node).join(); });
tell(() => underUndefined({ undefined: "u" }));
tell(() => underNull({ null: "n" }));
tell(() => underTrue({ true: "t" }));
tell(() => underUndefined(node));
tell(() => first(["zero"]));
tell(() => first({ 0: "nought" }));
tell(() => first("xyz"));
tell(() => above({}) === Object.prototype);
tell(() => above(node) === Item.prototype);
tell(() => { const o: any = {}; setAbove(o, { inherited: 1 }); return o.inherited; });
tell(() => { const o: any = {}; setAbove(o, { inherited: 1 }); return Object.keys(o).length; });
tell(() => lengthOf([1, 2, 3]));
tell(() => lengthOf("four"));
tell(() => lengthOf({ length: "own" }));
tell(() => { const o: any = { onopen: 0 }; listen(o, "open", 1); listen(o, "close", 2); return Object.keys(o).join() + o.onopen + o.onclose; });
tell(() => { const o: any = { set onopen(v: number) { report("setter " + v); } }; listen(o, "open", 3); return Object.keys(o).join(); });
tell(() => { const o: any = { a: 1 }; hide(o, "proto__", { inherited: 2 }); return o.inherited + Object.keys(o).join(); });
tell(() => { const o: any = { a: 1 }; hide(o, "other", 3); return Object.keys(o).join(); });
report("end");
