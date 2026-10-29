const p = await import("main");
console.log(p.x(), p.y, Object.keys(p).join());
