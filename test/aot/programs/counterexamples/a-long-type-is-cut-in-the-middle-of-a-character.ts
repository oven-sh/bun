// The text of a type is cut at 320 bytes, here between the two bytes of a letter. It once went into the program as it was, and the build ended with an internal error.
export function same(text: "aéééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé") { return text; }
console.log(typeof same);
