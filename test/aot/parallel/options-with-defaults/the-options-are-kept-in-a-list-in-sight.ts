// The options objects are kept in a list that stays in sight, so they are made and Link still knows every writer of `after`: the closure, made once in front of the loop, lies in the slot that may leave a closure unmade, beside literals that write theirs in place.
interface Plan { span?: number; look?: { tint?: string }; after?: (width: number) => void }
function run(turns: number): string {
  let seen = 0;
  const note = (width: number) => { seen += width; };
  const kept: Plan[] = [];
  for (let i = 0; i < turns; i++) {
    kept.push({ look: { tint: "red" }, after: note });
    kept.push({ span: i, after: note });
    kept.push({ after: note, span: i });
    kept.push({ span: i });
  }
  let same = 0, has = 0, kinds = 0;
  for (const plan of kept) {
    plan.after?.(plan.span ?? 1);
    same += plan.after === note ? 1 : 0;
    has += "after" in plan ? 1 : 0;
    kinds += typeof plan.after === "function" ? 1 : 0;
  }
  return [seen, same, has, kinds, Object.keys(kept[0]).join(), Object.keys(kept[1]).join(), Object.keys(kept[2]).join(), Object.keys(kept[3]).join()].join(" ");
}
console.log(run(400));
