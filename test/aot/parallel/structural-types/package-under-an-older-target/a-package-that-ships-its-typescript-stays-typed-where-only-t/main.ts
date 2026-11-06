import { Named, Limited, Late, pick } from "ships-typescript";
declare const console: { log(...values: unknown[]): void };
console.log(
  Named.name,
  new Limited("seven").max,
  new Limited("seven").text,
  new Late(true).text,
  new Late(false).extra,
  pick(undefined),
);
