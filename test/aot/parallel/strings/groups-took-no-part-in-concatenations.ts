// A group that took no part in the match is undefined, also where the result of exec or match is only taken apart and the groups are concatenated.
function viaExec(line: string): string {
  const m = /(\d)(x)?/.exec(line);
  return m ? m[1] + m[2] + m.index : "null";
}
function viaMatch(line: string): string {
  const m = line.match(/a(b)?/y);
  return m ? m[0] + m[1] + m.index : "null";
}
function alone(line: string): string {
  const m = /(\d)(x)?/.exec(line);
  return m ? String(m[2]) + typeof m[2] : "null";
}
function firstGroupMissing(line: string): string {
  const m = /(x)?(\d)/.exec(line);
  return m ? m[1] + "|" + m[2] : "null";
}
function bothMissing(line: string): string {
  const m = /(x)?(y)?-/.exec(line);
  return m ? m[1] + m[2] + "" : "null";
}
function inTemplate(line: string): string {
  const m = /(\d)(x)?(\d)?/.exec(line);
  return m ? `${m[1]}${m[2]}${m[3]}` : "null";
}
for (const line of ["12-ok", "1x2-", "a=b", "ab", "-", "xy-", "nothing"]) {
  console.log(line, viaExec(line), viaMatch(line), alone(line), firstGroupMissing(line), bothMissing(line), inTemplate(line));
}
