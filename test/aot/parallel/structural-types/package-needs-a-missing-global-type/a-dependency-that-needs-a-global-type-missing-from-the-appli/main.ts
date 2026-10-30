import { first } from "ships-typescript";
first().then(value => console.log(value));
declare const console: { log(...values: unknown[]): void };
