interface Form {
  first: string;
  second: string;
  third: string;
}
const seen: string[] = [];
function build(): Form {
  return Object.assign(
    {
      first: "1",
      set probe(value: string) {
        const form = this as unknown as Form;
        seen.push([value, form.first, form.second, form.third, "second" in form, "third" in form, Object.keys(form).join("+")].join());
      },
    },
    { second: "2", probe: "a" },
    { third: "3", probe: "b" },
  ) as unknown as Form;
}
const form = build();
console.log(seen.join(" | "));
console.log(form.first + form.second + form.third, Object.keys(form).join());
let failure = "none";
let half: Form | undefined;
try {
  Object.assign(
    {
      first: "1",
      set keep(_: number) {
        half = this as unknown as Form;
      },
    },
    { keep: 0, second: "2" },
    {
      get third(): string {
        throw new RangeError("no third");
      },
    },
  ) as unknown as Form;
} catch (error) {
  failure = (error as Error).message;
}
console.log(failure, half!.first, half!.second, half!.third, Object.keys(half!).join());
