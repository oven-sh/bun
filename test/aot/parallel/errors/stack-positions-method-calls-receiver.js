// Prints where a stack trace places a method call `receiver.method()` while the read of the method throws or runs a getter, and while the method runs: with receivers written short and long, in other letters, as calls and in brackets, with the member on the same line and on the next.
// The text that is never evaluated keeps the compiler from knowing what else runs, so nothing is known about the receivers.
if (process.argv.length > 1000) (0, eval)(process.argv[1000]);
const inThisFile = /stack-positions-method-calls-receiver/;
function placesOf(error) {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]).join(" ");
}
function show(label, run) {
  try {
    console.log(label, "|", run());
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error));
  }
}
const kinds = {
  nothing: null,
  missing: undefined,
  throwsInGetter: { get method() { throw new Error("getter"); } },
  looksInGetter: { get method() { const places = placesOf(new Error("look")); return () => places; } },
  throwsInMethod: { method() { throw new Error("method"); } },
  looksInMethod: { method() { return placesOf(new Error("look")); } },
  holdsNumber: { method: 5 },
  holdsNothing: {},
  behindProxy: new Proxy({}, { get() { throw new Error("trap"); } }),
  text: "text",
};
{
  function run(object) {
    
    try {
      const result = object.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try object.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = object.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try object.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = object . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try object . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = object
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try object\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = object?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try object?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = object.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try object.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = object['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try object['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    try {
      const result = holder.object.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.object.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    try {
      const result = holder.object.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.object.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    try {
      const result = holder.object . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.object . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    try {
      const result = holder.object
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.object\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    try {
      const result = holder.object?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.object?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    try {
      const result = holder.object.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.object.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    try {
      const result = holder.object['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.object['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    try {
      const result = holder.inner.object.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.inner.object.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    try {
      const result = holder.inner.object.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.inner.object.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    try {
      const result = holder.inner.object . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.inner.object . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    try {
      const result = holder.inner.object
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.inner.object\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    try {
      const result = holder.inner.object?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.inner.object?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    try {
      const result = holder.inner.object.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.inner.object.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    try {
      const result = holder.inner.object['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try holder.inner.object['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    try {
      const result = aVeryLongNameOfTwentyNineChars.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfTwentyNineChars.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    try {
      const result = aVeryLongNameOfTwentyNineChars.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfTwentyNineChars.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    try {
      const result = aVeryLongNameOfTwentyNineChars . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfTwentyNineChars . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    try {
      const result = aVeryLongNameOfTwentyNineChars
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfTwentyNineChars\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    try {
      const result = aVeryLongNameOfTwentyNineChars?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfTwentyNineChars?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    try {
      const result = aVeryLongNameOfTwentyNineChars.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfTwentyNineChars.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    try {
      const result = aVeryLongNameOfTwentyNineChars['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfTwentyNineChars['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    try {
      const result = aVeryLongNameOfExactlyThirtyCh.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfExactlyThirtyCh.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    try {
      const result = aVeryLongNameOfExactlyThirtyCh.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfExactlyThirtyCh.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    try {
      const result = aVeryLongNameOfExactlyThirtyCh . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfExactlyThirtyCh . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    try {
      const result = aVeryLongNameOfExactlyThirtyCh
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfExactlyThirtyCh\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    try {
      const result = aVeryLongNameOfExactlyThirtyCh?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfExactlyThirtyCh?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    try {
      const result = aVeryLongNameOfExactlyThirtyCh.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfExactlyThirtyCh.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    try {
      const result = aVeryLongNameOfExactlyThirtyCh['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfExactlyThirtyCh['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    try {
      const result = aVeryLongNameOfThirtyOneLetters.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyOneLetters.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    try {
      const result = aVeryLongNameOfThirtyOneLetters.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyOneLetters.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    try {
      const result = aVeryLongNameOfThirtyOneLetters . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyOneLetters . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    try {
      const result = aVeryLongNameOfThirtyOneLetters
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyOneLetters\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    try {
      const result = aVeryLongNameOfThirtyOneLetters?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyOneLetters?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    try {
      const result = aVeryLongNameOfThirtyOneLetters.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyOneLetters.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    try {
      const result = aVeryLongNameOfThirtyOneLetters['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyOneLetters['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    try {
      const result = aVeryLongNameOfThirtyTwoLettersX.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyTwoLettersX.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    try {
      const result = aVeryLongNameOfThirtyTwoLettersX.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyTwoLettersX.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    try {
      const result = aVeryLongNameOfThirtyTwoLettersX . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyTwoLettersX . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    try {
      const result = aVeryLongNameOfThirtyTwoLettersX
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyTwoLettersX\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    try {
      const result = aVeryLongNameOfThirtyTwoLettersX?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyTwoLettersX?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    try {
      const result = aVeryLongNameOfThirtyTwoLettersX.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyTwoLettersX.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    try {
      const result = aVeryLongNameOfThirtyTwoLettersX['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aVeryLongNameOfThirtyTwoLettersX['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    try {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    try {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    try {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    try {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    try {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    try {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    try {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    try {
      const result = give().method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try give().method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    try {
      const result = give().method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try give().method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    try {
      const result = give() . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try give() . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    try {
      const result = give()
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try give()\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    try {
      const result = give()?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try give()?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    try {
      const result = give().method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try give().method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    try {
      const result = give()['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try give()['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    try {
      const result = list[0].method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try list[0].method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    try {
      const result = list[0].method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try list[0].method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    try {
      const result = list[0] . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try list[0] . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    try {
      const result = list[0]
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try list[0]\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    try {
      const result = list[0]?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try list[0]?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    try {
      const result = list[0].method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try list[0].method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    try {
      const result = list[0]['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try list[0]['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = (object).method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try (object).method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = (object).method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try (object).method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = (object) . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try (object) . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = (object)
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try (object)\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = (object)?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try (object)?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = (object).method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try (object).method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = (object)['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try (object)['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    try {
      const result = this.object.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try this.object.method()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    try {
      const result = this.object.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try this.object.method(1, 2, 3, 4)" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    try {
      const result = this.object . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try this.object . method ()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    try {
      const result = this.object
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try this.object\\n.method()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    try {
      const result = this.object?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try this.object?.method()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    try {
      const result = this.object.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try this.object.method?.()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    try {
      const result = this.object['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try this.object['method']()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    const héros = object;
    try {
      const result = héros.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try héros.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    try {
      const result = héros.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try héros.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    try {
      const result = héros . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try héros . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    try {
      const result = héros
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try héros\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    try {
      const result = héros?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try héros?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    try {
      const result = héros.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try héros.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    try {
      const result = héros['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try héros['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    try {
      const result = 𝓐.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try 𝓐.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    try {
      const result = 𝓐.method(1, 2, 3, 4);
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try 𝓐.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    try {
      const result = 𝓐 . method ();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try 𝓐 . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    try {
      const result = 𝓐
      .method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try 𝓐\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    try {
      const result = 𝓐?.method();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try 𝓐?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    try {
      const result = 𝓐.method?.();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try 𝓐.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    try {
      const result = 𝓐['method']();
      return result;
    } catch (error) {
      return "caught " + error.constructor.name + " " + placesOf(error);
    }
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("try 𝓐['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = object.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner object.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = object.method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner object.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = object . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner object . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = object
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner object\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = object?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner object?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = object.method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner object.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = object['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner object['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    const inner = () => {
      const result = holder.object.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.object.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    const inner = () => {
      const result = holder.object.method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.object.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    const inner = () => {
      const result = holder.object . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.object . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    const inner = () => {
      const result = holder.object
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.object\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    const inner = () => {
      const result = holder.object?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.object?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    const inner = () => {
      const result = holder.object.method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.object.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    const inner = () => {
      const result = holder.object['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.object['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    const inner = () => {
      const result = holder.inner.object.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.inner.object.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    const inner = () => {
      const result = holder.inner.object.method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.inner.object.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    const inner = () => {
      const result = holder.inner.object . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.inner.object . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    const inner = () => {
      const result = holder.inner.object
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.inner.object\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    const inner = () => {
      const result = holder.inner.object?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.inner.object?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    const inner = () => {
      const result = holder.inner.object.method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.inner.object.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    const inner = () => {
      const result = holder.inner.object['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner holder.inner.object['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    const inner = () => {
      const result = aVeryLongNameOfTwentyNineChars.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfTwentyNineChars.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    const inner = () => {
      const result = aVeryLongNameOfTwentyNineChars.method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfTwentyNineChars.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    const inner = () => {
      const result = aVeryLongNameOfTwentyNineChars . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfTwentyNineChars . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    const inner = () => {
      const result = aVeryLongNameOfTwentyNineChars
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfTwentyNineChars\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    const inner = () => {
      const result = aVeryLongNameOfTwentyNineChars?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfTwentyNineChars?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    const inner = () => {
      const result = aVeryLongNameOfTwentyNineChars.method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfTwentyNineChars.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    const inner = () => {
      const result = aVeryLongNameOfTwentyNineChars['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfTwentyNineChars['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    const inner = () => {
      const result = aVeryLongNameOfExactlyThirtyCh.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfExactlyThirtyCh.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    const inner = () => {
      const result = aVeryLongNameOfExactlyThirtyCh.method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfExactlyThirtyCh.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    const inner = () => {
      const result = aVeryLongNameOfExactlyThirtyCh . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfExactlyThirtyCh . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    const inner = () => {
      const result = aVeryLongNameOfExactlyThirtyCh
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfExactlyThirtyCh\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    const inner = () => {
      const result = aVeryLongNameOfExactlyThirtyCh?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfExactlyThirtyCh?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    const inner = () => {
      const result = aVeryLongNameOfExactlyThirtyCh.method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfExactlyThirtyCh.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    const inner = () => {
      const result = aVeryLongNameOfExactlyThirtyCh['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfExactlyThirtyCh['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyOneLetters.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyOneLetters.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyOneLetters.method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyOneLetters.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyOneLetters . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyOneLetters . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyOneLetters
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyOneLetters\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyOneLetters?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyOneLetters?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyOneLetters.method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyOneLetters.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyOneLetters['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyOneLetters['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyTwoLettersX.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyTwoLettersX.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyTwoLettersX.method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyTwoLettersX.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyTwoLettersX . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyTwoLettersX . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyTwoLettersX
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyTwoLettersX\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyTwoLettersX?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyTwoLettersX?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyTwoLettersX.method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyTwoLettersX.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    const inner = () => {
      const result = aVeryLongNameOfThirtyTwoLettersX['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aVeryLongNameOfThirtyTwoLettersX['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    const inner = () => {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    const inner = () => {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    const inner = () => {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    const inner = () => {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    const inner = () => {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    const inner = () => {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    const inner = () => {
      const result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    const inner = () => {
      const result = give().method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner give().method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    const inner = () => {
      const result = give().method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner give().method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    const inner = () => {
      const result = give() . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner give() . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    const inner = () => {
      const result = give()
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner give()\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    const inner = () => {
      const result = give()?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner give()?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    const inner = () => {
      const result = give().method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner give().method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    const inner = () => {
      const result = give()['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner give()['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    const inner = () => {
      const result = list[0].method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner list[0].method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    const inner = () => {
      const result = list[0].method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner list[0].method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    const inner = () => {
      const result = list[0] . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner list[0] . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    const inner = () => {
      const result = list[0]
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner list[0]\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    const inner = () => {
      const result = list[0]?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner list[0]?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    const inner = () => {
      const result = list[0].method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner list[0].method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    const inner = () => {
      const result = list[0]['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner list[0]['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = (object).method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner (object).method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = (object).method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner (object).method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = (object) . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner (object) . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = (object)
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner (object)\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = (object)?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner (object)?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = (object).method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner (object).method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    const inner = () => {
      const result = (object)['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner (object)['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    const inner = () => {
      const result = héros.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner héros.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    const inner = () => {
      const result = héros.method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner héros.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    const inner = () => {
      const result = héros . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner héros . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    const inner = () => {
      const result = héros
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner héros\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    const inner = () => {
      const result = héros?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner héros?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    const inner = () => {
      const result = héros.method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner héros.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    const inner = () => {
      const result = héros['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner héros['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    const inner = () => {
      const result = 𝓐.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner 𝓐.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    const inner = () => {
      const result = 𝓐.method(1, 2, 3, 4);
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner 𝓐.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    const inner = () => {
      const result = 𝓐 . method ();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner 𝓐 . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    const inner = () => {
      const result = 𝓐
      .method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner 𝓐\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    const inner = () => {
      const result = 𝓐?.method();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner 𝓐?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    const inner = () => {
      const result = 𝓐.method?.();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner 𝓐.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    const inner = () => {
      const result = 𝓐['method']();
      return result;
    };
    const result = inner();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("inner 𝓐['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = object.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop object.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = object.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop object.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = object . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop object . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = object
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop object\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = object?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop object?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = object.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop object.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = object['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop object['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    let result;
    for (let i = 0; i < 3; i++) result = holder.object.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.object.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    let result;
    for (let i = 0; i < 3; i++) result = holder.object.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.object.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    let result;
    for (let i = 0; i < 3; i++) result = holder.object . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.object . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    let result;
    for (let i = 0; i < 3; i++) result = holder.object
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.object\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    let result;
    for (let i = 0; i < 3; i++) result = holder.object?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.object?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    let result;
    for (let i = 0; i < 3; i++) result = holder.object.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.object.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { object };
    let result;
    for (let i = 0; i < 3; i++) result = holder.object['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.object['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    let result;
    for (let i = 0; i < 3; i++) result = holder.inner.object.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.inner.object.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    let result;
    for (let i = 0; i < 3; i++) result = holder.inner.object.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.inner.object.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    let result;
    for (let i = 0; i < 3; i++) result = holder.inner.object . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.inner.object . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    let result;
    for (let i = 0; i < 3; i++) result = holder.inner.object
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.inner.object\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    let result;
    for (let i = 0; i < 3; i++) result = holder.inner.object?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.inner.object?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    let result;
    for (let i = 0; i < 3; i++) result = holder.inner.object.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.inner.object.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const holder = { inner: { object } };
    let result;
    for (let i = 0; i < 3; i++) result = holder.inner.object['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop holder.inner.object['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfTwentyNineChars.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfTwentyNineChars.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfTwentyNineChars.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfTwentyNineChars.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfTwentyNineChars . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfTwentyNineChars . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfTwentyNineChars
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfTwentyNineChars\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfTwentyNineChars?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfTwentyNineChars?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfTwentyNineChars.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfTwentyNineChars.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfTwentyNineChars = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfTwentyNineChars['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfTwentyNineChars['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfExactlyThirtyCh.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfExactlyThirtyCh.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfExactlyThirtyCh.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfExactlyThirtyCh.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfExactlyThirtyCh . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfExactlyThirtyCh . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfExactlyThirtyCh
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfExactlyThirtyCh\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfExactlyThirtyCh?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfExactlyThirtyCh?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfExactlyThirtyCh.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfExactlyThirtyCh.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfExactlyThirtyCh = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfExactlyThirtyCh['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfExactlyThirtyCh['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyOneLetters.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyOneLetters.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyOneLetters.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyOneLetters.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyOneLetters . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyOneLetters . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyOneLetters
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyOneLetters\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyOneLetters?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyOneLetters?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyOneLetters.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyOneLetters.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyOneLetters = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyOneLetters['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyOneLetters['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyTwoLettersX.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyTwoLettersX.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyTwoLettersX.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyTwoLettersX.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyTwoLettersX . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyTwoLettersX . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyTwoLettersX
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyTwoLettersX\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyTwoLettersX?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyTwoLettersX?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyTwoLettersX.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyTwoLettersX.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aVeryLongNameOfThirtyTwoLettersX = object;
    let result;
    for (let i = 0; i < 3; i++) result = aVeryLongNameOfThirtyTwoLettersX['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aVeryLongNameOfThirtyTwoLettersX['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    let result;
    for (let i = 0; i < 3; i++) result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    let result;
    for (let i = 0; i < 3; i++) result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    let result;
    for (let i = 0; i < 3; i++) result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    let result;
    for (let i = 0; i < 3; i++) result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    let result;
    for (let i = 0; i < 3; i++) result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    let result;
    for (let i = 0; i < 3; i++) result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText = object;
    let result;
    for (let i = 0; i < 3; i++) result = aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop aNameThatIsMuchLongerThanAnyFieldOfFiveOrSixBitsCanCountUpToInColumnsOfText['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    let result;
    for (let i = 0; i < 3; i++) result = give().method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop give().method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    let result;
    for (let i = 0; i < 3; i++) result = give().method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop give().method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    let result;
    for (let i = 0; i < 3; i++) result = give() . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop give() . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    let result;
    for (let i = 0; i < 3; i++) result = give()
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop give()\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    let result;
    for (let i = 0; i < 3; i++) result = give()?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop give()?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    let result;
    for (let i = 0; i < 3; i++) result = give().method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop give().method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const give = () => object;
    let result;
    for (let i = 0; i < 3; i++) result = give()['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop give()['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    let result;
    for (let i = 0; i < 3; i++) result = list[0].method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop list[0].method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    let result;
    for (let i = 0; i < 3; i++) result = list[0].method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop list[0].method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    let result;
    for (let i = 0; i < 3; i++) result = list[0] . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop list[0] . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    let result;
    for (let i = 0; i < 3; i++) result = list[0]
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop list[0]\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    let result;
    for (let i = 0; i < 3; i++) result = list[0]?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop list[0]?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    let result;
    for (let i = 0; i < 3; i++) result = list[0].method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop list[0].method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const list = [object];
    let result;
    for (let i = 0; i < 3; i++) result = list[0]['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop list[0]['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = (object).method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop (object).method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = (object).method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop (object).method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = (object) . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop (object) . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = (object)
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop (object)\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = (object)?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop (object)?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = (object).method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop (object).method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = (object)['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop (object)['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = this.object.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop this.object.method()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = this.object.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop this.object.method(1, 2, 3, 4)" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = this.object . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop this.object . method ()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = this.object
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop this.object\\n.method()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = this.object?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop this.object?.method()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = this.object.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop this.object.method?.()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    
    let result;
    for (let i = 0; i < 3; i++) result = this.object['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop this.object['method']()" + " " + key, () => run.call({ object }, object));
  }
}
{
  function run(object) {
    const héros = object;
    let result;
    for (let i = 0; i < 3; i++) result = héros.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop héros.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    let result;
    for (let i = 0; i < 3; i++) result = héros.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop héros.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    let result;
    for (let i = 0; i < 3; i++) result = héros . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop héros . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    let result;
    for (let i = 0; i < 3; i++) result = héros
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop héros\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    let result;
    for (let i = 0; i < 3; i++) result = héros?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop héros?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    let result;
    for (let i = 0; i < 3; i++) result = héros.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop héros.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const héros = object;
    let result;
    for (let i = 0; i < 3; i++) result = héros['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop héros['method']()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    let result;
    for (let i = 0; i < 3; i++) result = 𝓐.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop 𝓐.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    let result;
    for (let i = 0; i < 3; i++) result = 𝓐.method(1, 2, 3, 4);
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop 𝓐.method(1, 2, 3, 4)" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    let result;
    for (let i = 0; i < 3; i++) result = 𝓐 . method ();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop 𝓐 . method ()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    let result;
    for (let i = 0; i < 3; i++) result = 𝓐
      .method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop 𝓐\\n.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    let result;
    for (let i = 0; i < 3; i++) result = 𝓐?.method();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop 𝓐?.method()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    let result;
    for (let i = 0; i < 3; i++) result = 𝓐.method?.();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop 𝓐.method?.()" + " " + key, () => run(object));
  }
}
{
  function run(object) {
    const 𝓐 = object;
    let result;
    for (let i = 0; i < 3; i++) result = 𝓐['method']();
    return result;
  }
  for (const key of Object.keys(kinds)) {
    const object = kinds[key];
    show("loop 𝓐['method']()" + " " + key, () => run(object));
  }
}
