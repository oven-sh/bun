const m = await import("/workspace/bun/test/js/node/assert/deep-equal-cases.ts");
const v = m.verdictsOfRows();
const out = [];
m.cases.forEach((c, i) => {
  const [l, ls, s, ss, k, ks] = [...v[i]].map(x => x === "1");
  const fields = {};
  const base = {};
  if (c.loose !== l) base.loose = l;
  if (c.strict !== s) base.strict = s;
  if (k !== s && c.skipPrototype === undefined) fields.skipPrototype = k;
  const swapped = {};
  if (ls !== l) swapped.loose = ls;
  if (ss !== s) swapped.strict = ss;
  const skipDefaultSwapped = k === s ? (swapped.strict ?? k) : k;
  if (ks !== skipDefaultSwapped) swapped.skipPrototype = ks;
  if (Object.keys(swapped).length && c.swapped === undefined) fields.swapped = swapped;
  if (Object.keys(fields).length || Object.keys(base).length) out.push({ name: c.name, node: v[i], fields, base });
});
console.log(JSON.stringify(out));
