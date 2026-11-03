// A function that is found on the global object calls what it is handed. What it is handed maps a list of texts, and the callback spreads each text into a new list.
// Flags: --aot-check=verify-each-pass
globalThis.show = function (name, run) {
  try {
    console.log(name, JSON.stringify(run()));
  } catch (error) {
    console.log(name, String(error));
  }
};
show("texts", function () {
  return ["ab", "", "c\u{1F600}d"].map(text => [...text]);
});
show("a text and nothing", function () {
  return ["ab", undefined].map(text => [text, ...text]);
});
