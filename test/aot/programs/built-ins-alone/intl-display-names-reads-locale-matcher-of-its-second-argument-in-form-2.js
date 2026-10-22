let calls = 0;
const probe = {
  count: 0,
  type: "region",
  get localeMatcher() {
    calls++;
    this.count++;
    console.log("localeMatcher", this === probe);
    return undefined;
  },
};
const result = new Intl.DisplayNames(1.5, probe);
console.log(typeof result, Object.keys(result).join(), typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.type, typeof probe.localeMatcher, probe.localeMatcher === undefined);
console.log(calls, probe.count);
