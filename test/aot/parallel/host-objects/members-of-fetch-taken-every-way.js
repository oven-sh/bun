// fetch.preconnect counts its operands, converts the first to a string and refuses what is no address.
// STATISTIC: ImageFunctionsEmitted <= 40
const refused = call => {
  try {
    call();
  } catch (error) {
    console.log(error.name, error.code, error.message);
  }
};
refused(() => fetch.preconnect());
refused(() => fetch.preconnect(""));
refused(() => fetch.preconnect(undefined));
refused(() => fetch.preconnect(Symbol()));
refused(() =>
  Bun.fetch.preconnect({
    toString() {
      console.log("asked");
      return "";
    },
  }),
);
refused(() =>
  fetch.preconnect({
    [Symbol.toPrimitive](hint) {
      console.log(hint);
      throw new RangeError("mine");
    },
  }),
);
const { preconnect } = fetch;
refused(() => preconnect(""));
refused(() => preconnect.call({}, ""));
for (const member of Object.values(fetch)) refused(() => member(""));
refused(() => ({ ...fetch }).preconnect(""));
try {
  new fetch.preconnect("");
} catch (error) {
  console.log(error.name);
}
(function () {
  "use strict";
  refused(() => {
    fetch.preconnect = 1;
  });
  refused(() => {
    delete fetch.preconnect;
  });
})();
fetch.mine = 2;
console.log(typeof fetch.preconnect, fetch.mine, Object.keys(fetch));
