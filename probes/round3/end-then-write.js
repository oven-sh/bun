const ev = [];
const out = process.stdout;
if (process.env.AD) out._writableState.autoDestroy = true;
out.on("error", e => ev.push("error:" + e.code));
out.on("finish", () => ev.push("finish"));
out.on("close", () => ev.push("close"));
out.write("a\n");
out.end("b\n", e => {
  ev.push("end-cb:" + (e ? e.code : null));
  setImmediate(() => {
    ev.push(`state writable=${out.writable} ended=${out.writableEnded} finished=${out.writableFinished} destroyed=${out.destroyed}`);
    const r = out.write("c\n", e2 => { ev.push("late-cb:" + (e2 ? e2.code : null)); });
    ev.push("late-ret:" + r);
    setImmediate(() => setImmediate(() => { require("fs").writeSync(2, JSON.stringify(ev) + "\n"); process.exit(0); }));
  });
});
