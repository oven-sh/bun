import { countsBeforeItIsMade, readsBeforeItIsMade } from "./early";

console.log(readsBeforeItIsMade([1, 2, 3]), countsBeforeItIsMade([1, 2, 3]));
export enum State {
  Waiting = 1,
  Ready = 2,
  Done = 3,
}
export enum Level {
  Low,
  Middle,
  High,
}
