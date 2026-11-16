import { Base, LIMIT } from "./base";
export enum Level {
  Warn = Base.Warn,
  Error,
  Fatal,
  Written = 9,
  Next,
}
export const enum Inlined {
  Warn = Base.Warn,
  Error,
}
export enum BehindConstant {
  Most = LIMIT,
  More,
}
export enum Third {
  First = Level.Warn,
  Second,
}
export const failure = (text: string) => ({ level: Level.Error, text });
export const here = () => [
  Level.Warn,
  Level.Error,
  Level.Fatal,
  Level.Written,
  Level.Next,
  Inlined.Error,
  BehindConstant.More,
  Third.Second,
];
