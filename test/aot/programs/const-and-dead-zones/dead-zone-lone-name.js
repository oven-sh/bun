// A local is read and stored in its dead zone, and its name is nowhere else in the program: only the message of the ReferenceError quotes it.
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.name + ": " + error.message;
  }
}

function readTooEarly() {
  const early = [quotedOnlyByReadError];
  let quotedOnlyByReadError = 1;
  return early.length + quotedOnlyByReadError;
}
console.log(attempt(readTooEarly));

function storeTooEarly() {
  quotedOnlyByStoreError = 2;
  let quotedOnlyByStoreError = 1;
  return quotedOnlyByStoreError;
}
console.log(attempt(storeTooEarly));
