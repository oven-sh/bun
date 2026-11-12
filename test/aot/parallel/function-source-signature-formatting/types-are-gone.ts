// @ts-nocheck
type Context = { body: string; headers: Record<string, string> };
const forms: Function[] = [
  (c: Context) => c, (c : Context) => c, (c?: Context) => c, (c: Context): Context => c, (c:Context):Context=>c, <T,>(c: T) => c, <T>(c: T): T => c, async (c: Context): Promise<Context> => c, async <T>(c: T) => c,
  ({ body }: Context) => body, ({ body }: { body: string }) => body, ({ body, headers }: Context): string => body, ({
    body,
    headers,
  }: {
    body: string;
    headers: unknown;
  }) => body, (a: number, b: string = "b", ...rest: number[]) => a, (a: number /* first */, b?: string) => a,
  function (this: Context, a: number) {}, function <T>(a: T): void {}, function n<T> (a: T) {}, function (a: number,
    b: string,
  ): void {},
  (c) => (c as Context).headers, (c) => (<Context>c).headers, (c) => (c satisfies Context).headers, (c) => (c!).headers, (c) => ((c as Context)).headers, (c) => (c.a as Context).headers, (c) => ((c as any) as Context).headers, (c) => ((c) as Context).headers, (c) => (((c)!) satisfies Context).headers,
  (c) => (c as any as Context).headers, (c) => (c as Context)?.headers, (c) => typeof(c as Context).headers,
  (c) => (c + 1 as any).headers, (c) => ({ a: 1 } as Context).headers, (c) => (c?.a as Context).headers,
];
for (const form of forms) console.log(JSON.stringify(String(form).replace(/\s+/g, " ")));
