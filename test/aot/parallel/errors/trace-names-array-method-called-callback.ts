// A trace that is taken in the callback of one array method names the method between the callback and the function that called it. `flatMap` ends in a tail call and is not named.
type Site = { getFunctionName(): string | null; isNative(): boolean };
(Error as any).prepareStackTrace = (_error: Error, sites: Site[]) =>
  sites.map(site => (site.getFunctionName() ?? "(none)") + (site.isNative() ? "[native]" : "")).join(" < ");
Error.stackTraceLimit = 12;
let captured = "";
function capture(): void {
  captured = String(new Error("x").stack);
}
function mapToNothing(): void {
  [1].map(() => capture());
}
function mapToNumbers(): number {
  return [1, 2].map(value => (capture(), value + 1))[0];
}
function mapToTexts(): string {
  return ["a"].map(value => (capture(), value + "b"))[0];
}
function forEach(): void {
  [1].forEach(() => capture());
}
function filter(): void {
  [1].filter(() => (capture(), true));
}
function flatMap(): void {
  [1].flatMap(() => (capture(), [1]));
}
function mapAsTheLastCall(): number[] {
  return [1].map(value => (capture(), value));
}
const makers = [mapToNothing, mapToNumbers, mapToTexts, forEach, filter, flatMap, mapAsTheLastCall];
for (let round = 0; round < 3; round++) {
  for (const make of makers) {
    make();
    if (round === 2) console.log(make.name, ":", captured);
  }
}
