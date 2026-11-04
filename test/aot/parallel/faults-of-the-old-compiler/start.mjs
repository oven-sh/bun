function prepare(ctx) { ctx.state = "ready"; ctx.count = 2; }
function look(c) { return (c.state ?? "idle") + " " + (c.count === 2 ? "two" : "none"); }
function start({ setup }) { const ctx = {}; try { setup(ctx); } catch {} return ctx; }
console.log(look(start({ setup: prepare })) + " " + look(start({})));
