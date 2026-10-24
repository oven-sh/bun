// The name of a layout is the text of its type, which is cut at 320 bytes: here between the two bytes of a letter.
interface Box<T> {
  value: T;
}

function wrap(): Box<"aéééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé"> {
  return { value: "aéééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé" };
}

// The text of a type site, which only the log of type mismatches asks for, is cut the same way.
export function same(text: "aéééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé") {
  return text;
}

const box = wrap();
console.log(box.value.length, same(box.value).length);
