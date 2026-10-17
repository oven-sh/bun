// A generic union that is declared in a types-only module (`import type`), created in a generic async function and read at one instantiation.
import type * as Types from "./types";
declare const console: { log(...values: unknown[]): void };
async function either<In, Result>(act: Types.Act<In>, chain: Promise<Result>): Promise<Types.Either<In, Result>> {
  await Promise.race([act.early, chain.then(() => undefined, () => undefined)]);
  if (act.isEarly()) {
    return { early: await act.early };
  }
  return { late: await chain };
}
type Entering = { text: string; extra?: readonly string[] };
type Answer = { drop?: string };
async function use(has: boolean): Promise<string> {
  const act: Types.Act<Entering> = { early: has ? Promise.resolve({ text: 'in' }) : new Promise<Entering>(() => {}), isEarly: () => has };
  const first = await either(act, Promise.resolve<Answer>({ drop: 'why' }));
  if (first.early) {
    const early = first.early;
    return 'early ' + early.text;
  }
  const late = first.late;
  return 'late ' + late.drop;
}
use(true).then(a => use(false).then(b => console.log(a, '|', b)));
const alike = JSON.parse('{"early":"s"}') as { early: string }; console.log(alike.early);
