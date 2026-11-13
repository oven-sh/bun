// The thread of typeCheckerApart() in type-check.ts.
import { typeChecker, type Checker } from "./type-check";

declare var self: Worker;
let check: Checker | undefined | null = null;
self.onmessage = ({ data }: MessageEvent) => {
  if (check === null) check = typeChecker(data.settings);
  postMessage(check?.(data.programs));
};
