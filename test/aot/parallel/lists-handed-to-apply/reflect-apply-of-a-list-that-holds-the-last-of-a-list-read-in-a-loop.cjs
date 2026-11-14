// The element of the written list is what a loop read last; nothing reads it behind the list, and the call stands behind a test.
// STATISTIC: CallsForwardedAfterTargetChecks >= 1
const outside = JSON.parse("{}");
const table = { join: (one, two) => one + two };
const rows = JSON.parse('[["a","b"],["c"],["d","e","f"],[]]');
function pick(texts, target) {
  let text = "";
  for (let i = 0; i < texts.length; i++) text = texts[i];
  const list = [text, "x"];
  if (texts.length > 1) return Reflect.apply(target, null, list);
  return "none";
}
outside.handed = [pick];
for (const row of rows) console.log(pick(row, table.join));
