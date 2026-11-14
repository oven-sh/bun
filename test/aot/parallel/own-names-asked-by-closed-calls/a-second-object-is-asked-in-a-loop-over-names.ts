// `for (name in config) if (!reserved.hasOwnProperty(name)) ..`: the function is found by a closed call, and the caches of the run time answer: the operation that files an answer is entered for the first questions and no more. The function of the host would never enter it.
// COUNT: operation:operationAOTHasOwnByValAndCache <= 60
var reserved: any = { key: true, ref: true }
function pick(config: any): any {
  const props: any = {}
  for (const name in config) if (!reserved.hasOwnProperty(name)) props[name] = config[name]
  return props
}
let names = 0
for (let turn = 0; turn < 20000; turn++) {
  const props = pick(turn % 2 ? { key: turn, width: 10, color: "red" } : { ref: null, bold: true })
  names += Object.keys(props).length
  if (props.hasOwnProperty("key") || props.hasOwnProperty("ref") || !props.hasOwnProperty(turn % 2 ? "width" : "bold")) throw new Error("a name is where it should not be")
}
console.log(names)
