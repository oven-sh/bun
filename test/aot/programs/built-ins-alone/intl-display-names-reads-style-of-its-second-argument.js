let calls = 0;
const probe = {
  count: 0,
  type: "region",
  get style() {
    calls++;
    this.count++;
    console.log("style", this === probe);
    return undefined;
  },
};
const result = new Intl.DisplayNames("en", probe);
console.log(typeof result, Object.keys(result).join(), typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.type, typeof probe.style, probe.style === undefined);
console.log(calls, probe.count);
