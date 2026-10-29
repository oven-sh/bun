// The factory pragma is a quoted text: a text is called, which throws.
/** @jsxRuntime classic */ /** @jsx "h" */ /** @jsxFrag "fragment" */
for (const make of [() => <a />, () => <>{1}</>]) {
  try {
    console.log(make());
  } catch (error) {
    console.log(error.name);
  }
}
