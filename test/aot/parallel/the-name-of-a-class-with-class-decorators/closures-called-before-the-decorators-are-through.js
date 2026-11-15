const seen = [];
const note = (value) => { seen.push(value); return () => {}; };
let read;
const member = () => { seen.push(read()); };
const look = (made) => { seen.push(read()); return class extends made {}; };
const late = (made, context) => { context.addInitializer(function () { seen.push(read(), this === read()); }); };

@late @look @look class Kit {
  static [(read = () => Kit, "key")] = 1;
  @note((() => Kit)()) field = 1;
  @note((() => typeof Kit)()) other = 1;
  @member method() {}
  @member static fixed() {}
}
console.log(seen.map((value) => typeof value === "string" || typeof value === "boolean" ? value : typeof value).join(), read() === Kit);
