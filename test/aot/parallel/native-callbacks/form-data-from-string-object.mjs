// FormData.from converts a String object given as the input or the boundary by calling its own toString.
let calls = 0;
const stringObject = text => {
  const object = new String(text);
  object.toString = () => {
    calls++;
    return text;
  };
  return object;
};
console.log(FormData.from(stringObject("a=1")).get("a"), calls);
const body = '--x\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n--x--\r\n';
console.log(FormData.from(body, stringObject("x")).get("b"), calls);
