import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  catchError,
  combineLatest,
  concatMap,
  debounceTime,
  filter,
  firstValueFrom,
  from,
  interval,
  lastValueFrom,
  map,
  mergeMap,
  of,
  reduce,
  retry,
  scan,
  share,
  switchMap,
  take,
  takeUntil,
  tap,
  throwError,
  timer,
  toArray,
  zip,
} from "rxjs";
import { TestScheduler } from "rxjs/testing";

console.log(
  await lastValueFrom(
    of(1, 2, 3, 4).pipe(
      filter(n => n % 2 === 0),
      map(n => n * 10),
      scan((sum, n) => sum + n, 0),
      toArray(),
    ),
  ),
);
console.log(
  await lastValueFrom(
    from([1, 2, 3]).pipe(
      concatMap(n => timer(5 - n).pipe(map(() => n))),
      toArray(),
    ),
  ),
  await firstValueFrom(zip(of("a", "b"), interval(1)).pipe(map(([letter, n]) => letter + n))),
);
let tries = 0;
console.log(
  await lastValueFrom(
    new Observable<number>(subscriber => {
      if (++tries < 3) subscriber.error(new Error("again"));
      else {
        subscriber.next(tries);
        subscriber.complete();
      }
    }).pipe(retry(5)),
  ),
  await lastValueFrom(throwError(() => new Error("x")).pipe(catchError(error => of((error as Error).message)))),
);
const subject = new BehaviorSubject(0),
  stop = new Subject<void>(),
  seen: string[] = [];
combineLatest([subject, of("k")])
  .pipe(takeUntil(stop), tap({ complete: () => seen.push("complete") }))
  .subscribe(([n, k]) => seen.push(k + n));
subject.next(1);
subject.next(2);
stop.next();
subject.next(3);
console.log(
  seen.join(),
  subject.value,
  await lastValueFrom(
    of(1, 2, 3).pipe(
      mergeMap(n => of(n, n)),
      reduce((a, b) => a + b),
    ),
    { defaultValue: 0 },
  ),
  await lastValueFrom(EMPTY, { defaultValue: "empty" }),
  await lastValueFrom(
    of(1, 2).pipe(
      switchMap(n => of(n * 2)),
      share(),
      take(1),
    ),
  ),
);
new TestScheduler((actual, expected) => console.log(JSON.stringify(actual) === JSON.stringify(expected))).run(
  ({ cold, expectObservable }) => expectObservable(cold("a-b--c|").pipe(debounceTime(2))).toBe("---b--(c|)"),
);
