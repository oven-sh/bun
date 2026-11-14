// STATISTIC: FieldsOutOfLine = 0
"use strict";
class Features {}
class Contact {
  constructor() {
    this.key = 0;
    this.features = new Features();
  }
  own() {
    this.features.owner = this;
    return this;
  }
  set(key) {
    this.key = key;
    this.features.referenceEdge = key & 255;
    this.features.incidentEdge = (key >> 8) & 255;
    this.features.incidentVertex = (key >> 16) & 255;
    this.features.flip = (key >> 24) & 255;
  }
}
const contacts = [];
for (let k = 0; k < 6; k++) contacts.push(k & 1 ? new Contact().own() : new Contact());
let sum = 0;
for (let k = 0; k < 600; k++) {
  const contact = contacts[k % 6];
  if (k % 6 !== 4) contact.set(k * 70001);
  const features = contact.features;
  sum += (features.flip ?? 1) + (features.incidentVertex ?? 2) * 3 + (features.owner ? features.owner.key % 7 : 5);
}
console.log(sum, contacts.map(contact => Object.keys(contact.features).join("+")).join());
