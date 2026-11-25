// Twelve statements, each a list of two spreads of the one before: 4,096 places at the run.
function run(t) { const l0 = [t, t + 1];
  const l1 = [...l0, ...l0];
  const l2 = [...l1, ...l1];
  const l3 = [...l2, ...l2];
  const l4 = [...l3, ...l3];
  const l5 = [...l4, ...l4];
  const l6 = [...l5, ...l5];
  const l7 = [...l6, ...l6];
  const l8 = [...l7, ...l7];
  const l9 = [...l8, ...l8];
  const l10 = [...l9, ...l9];
  const l11 = [...l10, ...l10];
  return l11.length + ":" + l11[0] + ":" + l11[4095] + ":" + l1.length + ":" + l1[3]; }
globalThis.handed = [run];
for (let t = 0; t < 3; t++) console.log(run(t));
