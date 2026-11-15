// Intl.ListFormat walks the list of texts of a tagged template.
function inWords(texts) {
  return new Intl.ListFormat("en").format(texts);
}
console.log(inWords`one${0}two${0}three`);
