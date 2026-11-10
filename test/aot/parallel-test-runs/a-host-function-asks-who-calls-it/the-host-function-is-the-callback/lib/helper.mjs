import { callerSourceOrigin } from "bun:jsc";
const file = origin => String(origin).split("/").pop();
export const answers = () => [
  file([1].map(callerSourceOrigin)[0]),
  [1].filter(callerSourceOrigin).length,
  [1].some(callerSourceOrigin),
  [1].find(callerSourceOrigin),
  [1].every(callerSourceOrigin),
  file([1, 2].reduce(callerSourceOrigin)),
  file(Array.from([1], callerSourceOrigin)[0]),
  file(Object.keys(Object.groupBy([1], callerSourceOrigin))[0]),
];
