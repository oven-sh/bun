function make(): Error {
  return new Error("made in innermost.ts");
}

const names = ["main", "middle", "innermost"];
const lines = make().stack!.split("\n");
export const framesOfModules = names.filter(name => lines.some(line => line.includes(name + ".ts")));
