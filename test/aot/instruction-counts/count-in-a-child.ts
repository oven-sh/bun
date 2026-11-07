import { countInstructions, rangesIn, type Request } from "./count-instructions";

const request: Request = await Bun.stdin.json();
const counted = await countInstructions(
  request.command,
  request.env,
  request.marksBeforeTheFirstWindow,
  request.numberOfWindows,
  maps => rangesIn(maps, request.command[0], request.functions),
);
console.log(JSON.stringify({ ...counted, windows: counted.windows.map(window => [...window]) }));
