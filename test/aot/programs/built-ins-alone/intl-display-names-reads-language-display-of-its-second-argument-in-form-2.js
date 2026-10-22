let calls = 0;
const probe = {
  count: 0,
  type: "region",
  get languageDisplay() {
    calls++;
    this.count++;
    console.log("languageDisplay", this === probe);
    return undefined;
  },
};
const result = new Intl.DisplayNames(1.5, probe);
console.log(typeof result, Object.keys(result).join(), typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.type, typeof probe.languageDisplay, probe.languageDisplay === undefined);
console.log(calls, probe.count);
