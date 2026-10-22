const values: any[] = JSON.parse('["abc", null, 5, {"length": 9}, [1, 2], true, ""]');
values.push(undefined);

class Label {
  n: number;
  constructor(s: string | undefined) {
    this.n = typeof s === "string" ? s.length : -1;
  }
}

class Count {
  n: number;
  constructor(v: number | null) {
    this.n = typeof v === "number" ? v + 1 : 0;
  }
}

function lengthOf(s: string | undefined): number {
  return typeof s === "string" ? s.length : -1;
}

function increment(v: number | undefined): number | string {
  return typeof v === "number" ? v + 1 : "none";
}

for (const value of values)
  console.log(new Label(value).n, new Count(value).n, lengthOf(value), increment(value));
