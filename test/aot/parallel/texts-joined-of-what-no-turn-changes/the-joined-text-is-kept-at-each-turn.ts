function fill(head: string, tail: string, turns: number): string[] {
  const kept: string[] = [];
  for (let turn = 0; turn < turns; turn++) kept.push(head + "/" + tail);
  return kept;
}
const some = fill(JSON.parse('"usr"'), JSON.parse('"bin"'), Number("3"));
console.log(some.join(), some.length, some[0] === some[2], fill(JSON.parse('"a"'), JSON.parse('"b"'), Number("0")).length);
