const held = Intl.getCanonicalLocales("an");
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value;
}
for (const value of held.map(value => value)) console.log(show(value));
