// The keys of a literal come in the order of its text, whoever creates them: the allocation, the run time for an accessor, a stub for what stands behind the accessor.
// The image lists that order, so no property of these literals asks the run time for its place among the keys.
// COUNT: operation:operationAOTDidCreateFieldAt = 0
// COUNT: operation:operationAOTDidCreateFieldsAt = 0
const hand = globalThis[process.env.NO_SUCH_NAME ?? "Object"];
const made = [];
made.push(
  hand({
    first: 1,
    get second() {
      return 2;
    },
    set third(value) {},
    fourth: 4,
    fifth: 5,
  }),
);
made.push(
  hand({
    get a() {
      return 1;
    },
    b: 2,
    get c() {
      return 3;
    },
    set c(value) {},
    d() {
      return 4;
    },
    f: 6,
  }),
);
made.push(
  hand({
    name: "tool",
    describe() {
      return "does";
    },
    get input() {
      return 1;
    },
    get output() {
      return "1";
    },
    label() {
      return "";
    },
    deferred: true,
    enabled() {
      return true;
    },
    path: "p",
    render() {
      return null;
    },
  }),
);
const later = hand({ one: 1 });
later.two = 2;
later.three = 3;
made.push(later);
for (const object of made)
  console.log(
    Object.keys(object).join(),
    JSON.stringify(object),
    Object.entries(Object.getOwnPropertyDescriptors(object))
      .map(([name, d]) => name + ":" + ("get" in d ? "accessor" : "value"))
      .join(),
  );
