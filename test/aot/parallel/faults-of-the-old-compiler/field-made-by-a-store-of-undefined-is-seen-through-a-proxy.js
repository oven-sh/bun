function show(p) { return (p.author ?? "-") + " " + (p.body ?? "-") + " " + ("warning" in p ? "yes" : "no"); }
const steps = (process.argv[2] ?? "calm,warning,body").split(","), kept = [];
for (let i = 0; i < steps.length; i++) {
  const s = { id: i }, what = steps[i];
  if (what === "author") s.author = i;
  else if (what === "body") s.body = i;
  else if (what === "warning") s.warning = i;
  else s.warning = undefined;
  kept.push(new Proxy(s, {}));
}
console.log(kept.map(show).join(", "));
