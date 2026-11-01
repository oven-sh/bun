// Promise all settled order: compiled answers as plain.
const r = await Promise.allSettled([
  Promise.reject(new Error("x")),
  1,
  new Promise(r => setTimeout(r, 1, "late")),
  {
    then(r) {
      r("thenable");
    },
  },
]);
console.log(JSON.stringify(r.map(x => x.value ?? x.reason.message)));
