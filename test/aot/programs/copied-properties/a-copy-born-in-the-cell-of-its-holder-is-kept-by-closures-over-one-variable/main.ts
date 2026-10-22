import { StatusError, createKeeper } from "./keeper";
const keeper = createKeeper({ most: 10, mostSlept: 3 }, { count: 5 });
const errors: unknown[] = [new TypeError("no response"), new StatusError(401), new StatusError(500), new StatusError(529), "text", undefined];
for (const error of errors) {
  keeper.report(error, "again");
  keeper.report(error, "again", { couldHelp: true });
  keeper.report(error, "fail");
  keeper.report(error, undefined);
  console.log(JSON.stringify(keeper.tally()));
}
keeper.remember();
console.log(keeper.gaveUp(new StatusError(500)), keeper.spent());
keeper.restore();
console.log(JSON.stringify(keeper.tally()));
