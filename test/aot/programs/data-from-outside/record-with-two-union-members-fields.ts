// A generic async function returns one of two record types, and a record with the fields of both arrives from JSON.
declare const console: { log(...values: unknown[]): void };
type Either<In, Result> = { early: In; late?: undefined } | { late: Result; early?: undefined };
type Act<In> = { early: Promise<In>; isEarly(): boolean };
async function either<In, Result>(act: Act<In>, chain: Promise<Result>): Promise<Either<In, Result>> {
  await Promise.race([act.early, chain.then(() => undefined, () => undefined)]);
  if (act.isEarly()) {
    return { early: await act.early };
  }
  return { late: await chain };
}
type Entering = { text: string; extra?: readonly string[] };
type Answer = { drop?: string };
async function use(has: boolean): Promise<string> {
  const act: Act<Entering> = { early: has ? Promise.resolve({ text: 'in' }) : new Promise<Entering>(() => {}), isEarly: () => has };
  const first = await either(act, Promise.resolve<Answer>({ drop: 'why' }));
  if (first.early) {
    const early = first.early;
    return 'early ' + early.text;
  }
  const late = first.late;
  return 'late ' + late.drop;
}
use(true).then(a => use(false).then(b => console.log(a, '|', b)));
const alike = JSON.parse('{"early":"s","late":"t"}') as { early: string; late: string }; console.log(alike.early);
export {};
