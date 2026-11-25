import { fetch_ } from "./tools/fetcher.mjs";
const hidden = (value) => [value][JSON.parse("0")];
for (const flag of [false, true]) {
  const chosen = hidden(flag) && fetch_;
  let answer;
  try { answer = chosen("./shelf.cjs"); } catch (error) { answer = error.constructor.name; }
  console.log(answer);
}
