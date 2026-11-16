// One value goes into both objects in two forms.
type Inner = { whole: number; anything: unknown };
type Outer = { id: number; boxed: unknown; inner: Inner };

function make(x: number, label: string): Outer {
  return { id: x, boxed: x, inner: { whole: x, anything: x } };
}

function layIn(outer: Outer, x: number) {
  outer.inner = { whole: x, anything: x };
  outer.boxed = x;
}

const all: Outer[] = [];
for (let i = 0; i < 6; i++) all.push(make(i + 0.5, "n" + i));
for (let i = 0; i < 6; i += 2) layIn(all[i], i * 3);
for (const outer of all) console.log(outer.id, outer.boxed, outer.inner.whole, outer.inner.anything);
