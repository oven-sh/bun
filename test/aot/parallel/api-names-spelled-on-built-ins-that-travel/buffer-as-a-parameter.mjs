function use(B) {
  return B.from("hi").toString("base64") + B.byteLength("hi") + B.concat([B.alloc(1)]).length;
}
console.log(use(Buffer));
