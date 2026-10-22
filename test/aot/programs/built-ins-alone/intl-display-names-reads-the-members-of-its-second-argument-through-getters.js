let calls = 0;
const probe = {
  count: 0,
  get type() {
    calls++;
    this.count++;
    console.log("getter type", this === probe);
    return "region";
  },
};
const result = new Intl.DisplayNames("en", probe);
console.log(typeof result, Object.keys(result).join(), typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.type);
console.log(calls, probe.count);
