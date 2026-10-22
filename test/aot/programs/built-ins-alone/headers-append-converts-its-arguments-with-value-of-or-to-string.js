let calls = 0;
const subject = new Headers({ first: "1", second: "two" });
const firstProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("firstProbe valueOf", this === firstProbe);
    return "an";
  },
  toString() {
    calls++;
    this.count++;
    console.log("firstProbe toString", this === firstProbe);
    return "an";
  },
};
const secondProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("secondProbe valueOf", this === secondProbe);
    return "-";
  },
  toString() {
    calls++;
    this.count++;
    console.log("secondProbe toString", this === secondProbe);
    return "-";
  },
};
const result = subject.append(firstProbe, secondProbe);
console.log(typeof result, result === undefined, subject instanceof Headers, Object.keys(subject).join());
const items = [...subject];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
console.log(Array.isArray(items[1]), items[1].length, Array.isArray(items[2]), items[2].length, typeof firstProbe);
console.log(Object.keys(firstProbe).join(), typeof firstProbe.count, firstProbe.count + 1, typeof firstProbe.valueOf, firstProbe.valueOf.length);
console.log(typeof firstProbe.toString, firstProbe.toString.length, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1, typeof secondProbe.valueOf, secondProbe.valueOf.length);
console.log(typeof secondProbe.toString, secondProbe.toString.length);
console.log(calls, firstProbe.count, secondProbe.count);
