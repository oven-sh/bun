const unseen = (0, eval)("(x) => x");
const nothing = unseen(undefined), empty = unseen({});
const show = (label) => {
  for (const attempt of [() => nothing.name, () => empty.run(), () => new empty.Maker(), () => "k" in nothing]) {
    try { attempt(); } catch (error) { console.log(label, JSON.stringify(error.message)); }
  }
};
try { Object.defineProperty(Error, "stackTraceLimit", { get() { return 10; }, configurable: true }); } catch (error) { console.log("define:", error.constructor.name); }
show("accessor");
