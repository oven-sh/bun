const unseen = (0, eval)("(x) => x");
Error.stackTraceLimit = 0;
const holder = unseen(undefined);
const tools = unseen({});
for (const attempt of [() => holder.name, () => tools.run()]) {
  try { attempt(); } catch (error) { console.log(error.message); }
}
