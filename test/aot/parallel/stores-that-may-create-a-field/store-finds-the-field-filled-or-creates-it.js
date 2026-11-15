function Parcel(weight) { this.weight = weight; this.sent = false; }
function mark(parcel, at) { parcel.sent = true; parcel.sentAt = at; parcel.carrier = "van" + at; }
const out = [];
for (let i = 0; i < 6; i++) {
  const parcel = new Parcel(i);
  if (i & 1) parcel.sentAt = -1;
  mark(parcel, i);
  mark(parcel, i + 10);
  out.push(Object.keys(parcel).join() + ":" + JSON.stringify(parcel));
}
console.log(out.join("\n"));
