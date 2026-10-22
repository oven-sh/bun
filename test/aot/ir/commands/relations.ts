// RUN: lower
// OPTIONS: relations
// CHECK: name="identity"{{*}} relations={subjects=[{fate=[IsReturned] results=1}] resultsFullyListed=1} {

export function identity(x: unknown) {
  return x;
}
