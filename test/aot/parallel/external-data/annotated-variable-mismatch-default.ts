// The initializer joins two `any` values with ??, || or &&.
interface Meta { sign: string[] | true; secrets?: string }
function first(app: any): string { const meta: Meta = app.own ?? app.shared; meta.secrets = "a"; return JSON.stringify(meta); }
function second(app: any): string { const meta: Meta = app.own || app.shared; meta.secrets = "b"; return JSON.stringify(meta); }
function third(app: any): string { const meta: Meta = app.own && app.shared; meta.secrets = "c"; return JSON.stringify(meta); }
console.log(first({ shared: { path: "/" } }), first({ own: { path: "/own" } }), first({ own: { sign: true } }));
console.log(second({ shared: { path: "/" } }), second({ own: { path: "/own" } }), second({ own: { sign: true } }));
console.log(third({ own: 1, shared: { path: "/" } }), third({ own: 1, shared: { sign: ["x"] } }));
