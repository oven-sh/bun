function make(target: any) {
  let pos = 0;
  const jump = () => { pos = target; };
  return { run(limit: number, at: number): string { let turns = 0; while (pos < limit) { pos++; turns++; if (pos === at) jump(); if (turns > 40) break; } return turns + " " + typeof pos + " " + pos; } };
}
console.log(make(JSON.parse("0.5")).run(Number(JSON.parse("6")), 3), "|", make(JSON.parse('"7"')).run(Number(JSON.parse("6")), 3), "|", make(JSON.parse("1")).run(Number(JSON.parse("6")), 3));
