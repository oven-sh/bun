// Response.json(value, init): the compiled text form must match the plain call, including the order of user code and the error messages.
// The compiler leaves a call that runs once as it is, so each case also runs from a loop.
// STATISTIC: SerializersCreated >= 1
interface Row {
  a: number;
  b: string;
  c: (boolean | null)[];
}

async function describe(response: Response): Promise<string> {
  return `${response.status} ${response.headers.get("content-type")} ${response.headers.get("x-a")} ${await response.text()}`;
}

function attempt(name: string, run: () => Response): void {
  try {
    run();
    console.log(name, "did not throw");
  } catch (error) {
    console.log(name, (error as Error).name, (error as Error).message);
  }
}

class Point {
  x = 1;
  y = 2;
  toJSON() {
    return { sum: this.x + this.y };
  }
}

function fromUnknown(value: unknown): Response {
  return Response.json(value);
}

function fromRows(rows: Row[]): Response[] {
  const responses: Response[] = [];
  for (const row of rows) {
    responses.push(Response.json(row));
    responses.push(Response.json(row, { status: 201, headers: { "x-a": "b" } }));
    responses.push(Response.json(row, 404));
    responses.push(Response.json(row, { headers: { "content-type": "application/custom" } }));
  }
  return responses;
}

function fromPoints(points: Point[]): Response[] {
  const responses: Response[] = [];
  for (const point of points) responses.push(Response.json(point));
  return responses;
}

function fromUnknownValues(values: unknown[]): (Response | string)[] {
  const results: (Response | string)[] = [];
  for (const value of values) {
    try {
      results.push(Response.json(value));
    } catch (error) {
      results.push(`${(error as Error).name} ${(error as Error).message}`);
    }
  }
  return results;
}

function withMutatingInit(rows: Row[]): Response[] {
  const responses: Response[] = [];
  for (const row of rows) {
    const init = {
      get status(): number {
        row.a = -1;
        return 202;
      },
    };
    responses.push(Response.json(row, init));
  }
  return responses;
}

console.log(await Response.json({ a: 1, b: "x", c: [true, null] }).text());
console.log(await describe(Response.json({ a: 1, b: "x", c: [true, null] }, { status: 201, headers: { "x-a": "b" } })));
console.log(await describe(Response.json({ a: 1, b: "x", c: [true, null] }, 404)));
console.log(await describe(Response.json({ a: 1 }, { headers: { "content-type": "application/custom" } })));
console.log(await describe(Response.json(new Point())));
console.log(await describe(fromUnknown({ nested: [1, "two", { three: 3 }] })));
console.log(await describe(fromUnknown("text")));
console.log(await describe(fromUnknown(new Point())));

const rows: Row[] = [
  { a: 1, b: "x", c: [true, null] },
  { a: -0.5, b: 'café "quoted" \\', c: [] },
  { a: 1e21, b: "漢字\n", c: [false] },
];
for (const response of fromRows(rows)) console.log(await describe(response));
for (const response of fromPoints([new Point(), new Point()])) console.log(await describe(response));
for (const result of fromUnknownValues([{ nested: [1, "two", { three: 3 }] }, "text", new Point(), null, undefined, () => 1, 10n, Symbol("s")])) {
  console.log(typeof result === "string" ? result : await describe(result));
}
for (const response of withMutatingInit(rows)) console.log(await describe(response));
console.log(rows.map(row => row.a).join());

attempt("undefined", () => Response.json(undefined));
attempt("function", () => Response.json(() => 1));
attempt("bigint", () => Response.json(10n));
attempt("unknown bigint", () => fromUnknown(10n));

const log: string[] = [];
const throwing = {
  get value(): number {
    log.push("value getter");
    throw new Error("value getter failed");
  },
};
const init = {
  get status(): number {
    log.push("status getter");
    return 202;
  },
};
attempt("throwing getter", () => Response.json(throwing, init));
console.log(log.join());

log.length = 0;
const ordered = {
  get value(): number {
    log.push("value getter");
    return 1;
  },
};
console.log(await describe(Response.json(ordered, init)));
console.log(log.join());

console.log(Object.keys(Response).join());
console.log("constructJSONFromText" in Response);
