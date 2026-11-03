const launder = new Function("value", process.argv[9] ?? "return value") as <V>(value: V) => V;
{
  const source: any = launder({ z: 3 });
  function make(): any {
    return { ...source, ...source };
  }
  let made: any;
  for (let turn = launder(0); turn < 3; turn++) made = make();
  console.log(JSON.stringify(made));
}
