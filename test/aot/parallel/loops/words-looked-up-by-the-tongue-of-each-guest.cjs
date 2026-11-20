// STATISTIC: VaryingKeyLookups >= 1
// Each turn looks a word up under the name that a guest bears, in a record of which nothing is known.
"use strict";
function greeted(words, guests) {
  let letters = 0;
  for (let n = 0; n < guests.length; n++) {
    const guest = guests[n];
    if (guest.tongue === "mute") continue;
    const word = words[guest.tongue];
    letters += word.length;
  }
  return letters;
}
module.exports = { greeted };
const guests = JSON.parse('[{"tongue":"fr"},{"tongue":"it"},{"tongue":"mute"},{"tongue":"fr"}]');
for (let n = 0; n < 2000; n++) guests.push({ tongue: n % 3 ? "fr" : n % 5 ? "it" : "mute" });
console.log(greeted(JSON.parse('{"fr":"salut","it":"ciao"}'), guests));
console.log(greeted(JSON.parse('{"it":"buongiorno","fr":"bonjour","de":"moin"}'), guests));
