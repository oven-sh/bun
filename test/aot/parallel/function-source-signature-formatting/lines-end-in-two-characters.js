const forms = [
  ({
    a,
    b,
  }) => a,
  (
    a,
    b
  ) => a,
  function (
    a // first
  ) {},
  c =>
    c,
];
for (const form of forms) console.log(JSON.stringify(String(form).replace(/\s+/g, " ")));
