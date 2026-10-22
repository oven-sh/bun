let calls = 0;
const subject = new Uint8Array([1, 2, 3]);
const firstProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("firstProbe valueOf", this === firstProbe);
    return 1;
  },
  toString() {
    calls++;
    this.count++;
    console.log("firstProbe toString", this === firstProbe);
    return "1";
  },
};
const secondProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("secondProbe valueOf", this === secondProbe);
    return 2;
  },
  toString() {
    calls++;
    this.count++;
    console.log("secondProbe toString", this === secondProbe);
    return "2";
  },
};
const thirdProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("thirdProbe valueOf", this === thirdProbe);
    return 3;
  },
  toString() {
    calls++;
    this.count++;
    console.log("thirdProbe toString", this === thirdProbe);
    return "3";
  },
};
const result = subject.copyWithin(firstProbe, secondProbe, thirdProbe);
console.log(result === subject, subject instanceof Uint8Array, subject.length, typeof subject[0], subject[0] + 1);
console.log(typeof subject[1], subject[1] + 1, typeof firstProbe, Object.keys(firstProbe).join());
console.log(typeof firstProbe.count, firstProbe.count + 1, typeof firstProbe.valueOf, firstProbe.valueOf.length);
console.log(typeof firstProbe.toString, firstProbe.toString.length, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1, typeof secondProbe.valueOf, secondProbe.valueOf.length);
console.log(typeof secondProbe.toString, secondProbe.toString.length, typeof thirdProbe, Object.keys(thirdProbe).join());
console.log(typeof thirdProbe.count, thirdProbe.count + 1, typeof thirdProbe.valueOf, thirdProbe.valueOf.length);
console.log(typeof thirdProbe.toString, thirdProbe.toString.length);
console.log(calls, firstProbe.count, secondProbe.count, thirdProbe.count);
