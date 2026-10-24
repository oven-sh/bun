// An async function that takes the rest of its arguments is found by a computed name and called where the stack has no room for its body: behind the call the caller's frame is as it was.
globalThis.countsTheRest = async function (first, ...rest) {
  await first;
  return rest.length;
};
function nothing() {}
function found() {
  return globalThis[Object.keys(globalThis).find(key => key === "countsTheRest")];
}
let probes = 0;
let strange = 0;

function inASmallFunction() {
  found()(1, 2, 3).then(nothing, nothing);
  return 1;
}

function down(level) {
  try {
    return down(level + 1) + 1;
  } catch (error) {
    if (probes++ < 2000)
      try {
        if (inASmallFunction() !== 1) strange++;
      } catch {}
    throw error;
  }
}

try {
  down(0);
} catch (error) {
  console.log(error instanceof RangeError);
}
console.log(await found()(1, 2, 3));
console.log(strange, "end");
